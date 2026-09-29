import { spawn } from "node:child_process";
import path from "node:path";
import { NextResponse } from "next/server";
import { verifyManualAuth } from "@/lib/auth";
import { scraperForSource, ENABLED_SOURCES } from "@/lib/scrapers";
import { linkedinLocationForCountry } from "@/lib/scrapers/positions";
import { jobSourceLabel } from "@/lib/job-sources";
import { ingestPostings } from "@/lib/agent/perception";
import { filterTechPostings } from "@/lib/agent/va-filter";
import { parseIngestPostings } from "@/lib/scraper/python-client";
import { describeIndeedOutcome } from "@/lib/scraper/indeed-outcome";
import { enqueueIndeedScrape } from "@/lib/indeed-queue";
import type { JobSource, RawPosting } from "@/types";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ── Local dev: spawn Python as a subprocess (Python endpoints only run on Vercel)

interface SubprocessResult {
  postings: RawPosting[] | null;
  /** Indeed only — why the run came back empty (see api/py/scrape_jobs.py). */
  reason?: string;
  timedOut: boolean;
  timeoutMs: number;
  /** Last few stderr lines, for error messages. */
  stderrTail: string;
}

// Indeed opens a real browser and waits for a human to clear an "I am not a
// robot" check: Chrome launch (up to 15s per candidate) + page load (up to 30s)
// + the 30s verify window. This path only runs locally, so there is no
// serverless ceiling to respect — give it room instead of racing it.
const INDEED_SUBPROCESS_TIMEOUT_MS = (() => {
  const n = Number(process.env.INDEED_SCRAPE_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 90_000;
})();

/** Kill the Python child *and* the browser it launched (plain kill orphans Chrome on Windows). */
function killTree(proc: ReturnType<typeof spawn>): void {
  if (!proc.pid) return;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
      return;
    } catch { /* fall through */ }
  }
  try { proc.kill(); } catch { /* already gone */ }
}

function tryPythonSubprocess(
  source: string,
  query?: string,
  location?: string
): Promise<SubprocessResult> {
  const scriptPath = path.join(process.cwd(), "api", "py", "scrape_jobs.py");
  const killMs = source === "indeed" ? INDEED_SUBPROCESS_TIMEOUT_MS : 55_000;
  return new Promise<SubprocessResult>((resolve) => {
    let stdout = "";
    let stderrBuf = "";
    const stderrLines: string[] = [];
    let done = false;
    const finish = (partial: Partial<SubprocessResult> & { postings: RawPosting[] | null }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({
        timedOut: false,
        timeoutMs: killMs,
        stderrTail: stderrLines.slice(-5).join(" | "),
        ...partial,
      });
    };
    const timer = setTimeout(() => {
      killTree(proc);
      finish({ postings: null, timedOut: true });
    }, killMs);
    // CLI is positional: <source> <query> <location>. Location only applies to
    // LinkedIn; pass it when we have a query (per-position scrapes always do).
    const args = query
      ? location
        ? [scriptPath, source, query, location]
        : [scriptPath, source, query]
      : [scriptPath, source];
    const proc = spawn(process.env.PYTHON ?? "python", args, {
      cwd: process.cwd(),
      env: { ...process.env },
    });
    proc.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    // Progress (incl. the "complete the check in the browser" banner) goes to
    // stderr. Echo it into the dev-server terminal and keep a tail for errors.
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      const parts = stderrBuf.split(/\r?\n/);
      stderrBuf = parts.pop() ?? "";
      for (const line of parts) {
        if (!line.trim()) continue;
        stderrLines.push(line.trim());
        console.log(`[scrape:${source}] ${line}`);
      }
    });
    proc.on("close", (code) => {
      if (stderrBuf.trim()) {
        stderrLines.push(stderrBuf.trim());
        console.log(`[scrape:${source}] ${stderrBuf.trim()}`);
      }
      if (code !== 0) { finish({ postings: null }); return; }
      try {
        const data = JSON.parse(stdout) as { ok?: boolean; jobs?: unknown[]; reason?: string };
        const reason = typeof data.reason === "string" ? data.reason : undefined;
        if (!data.ok || !Array.isArray(data.jobs) || data.jobs.length === 0) {
          finish({ postings: null, reason }); return;
        }
        finish({ postings: parseIngestPostings(data.jobs) as RawPosting[], reason });
      } catch { finish({ postings: null }); }
    });
    proc.on("error", (err) => {
      stderrLines.push(err.message);
      finish({ postings: null });
    });
  });
}

// ── Vercel: call the Python serverless function via HTTP ──────────────────────

async function tryPythonVercel(
  source: JobSource,
  origin: string,
  query?: string,
  location?: string
): Promise<RawPosting[] | null> {
  const secret = process.env.CRON_SECRET ?? process.env.ADMIN_TOKEN ?? "";
  try {
    const res = await fetch(`${origin}/api/py/scrape_jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        source,
        ...(query ? { query } : {}),
        ...(location ? { location } : {}),
      }),
      signal: AbortSignal.timeout(52_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { ok?: boolean; jobs?: unknown[] };
    if (!data.ok || !Array.isArray(data.jobs) || data.jobs.length === 0)
      return null;
    return parseIngestPostings(data.jobs) as RawPosting[];
  } catch {
    return null;
  }
}

async function tryPythonScraper(
  source: JobSource,
  origin: string,
  query?: string,
  location?: string
): Promise<SubprocessResult> {
  if (process.env.VERCEL !== "1") {
    // Local dev: spawn Python directly — the /api/py endpoint is Vercel-only
    return tryPythonSubprocess(source, query, location);
  }
  const postings = await tryPythonVercel(source, origin, query, location);
  return { postings, timedOut: false, timeoutMs: 52_000, stderrTail: "" };
}

export async function POST(request: Request) {
  if (!verifyManualAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { source?: string; query?: string; country?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const source = body.source as JobSource | undefined;
  const query = typeof body.query === "string" && body.query.trim() ? body.query.trim() : undefined;
  // LinkedIn scrapes a specific country; Indeed is USA-only and ignores it.
  const location =
    source === "linkedin" ? linkedinLocationForCountry(body.country) : undefined;
  if (!source || !ENABLED_SOURCES.includes(source)) {
    return NextResponse.json(
      { error: `Unknown or disabled source: ${source}` },
      { status: 400 }
    );
  }

  const scraper = scraperForSource(source);
  if (!scraper) {
    return NextResponse.json(
      { error: `No scraper for source: ${source}` },
      { status: 400 }
    );
  }

  const label = jobSourceLabel(source);
  const start = Date.now();

  // A Vercel function cannot display a browser on the user's PC. Queue Indeed
  // for the local worker, which polls over HTTPS and uploads the scraped jobs.
  if (source === "indeed" && process.env.VERCEL === "1") {
    const job = await enqueueIndeedScrape(query);
    return NextResponse.json(
      {
        ok: true,
        queued: true,
        jobId: job.id,
        status: job.status,
        source,
        label,
        count: 0,
        inserted: 0,
        durationMs: Date.now() - start,
      },
      { status: 202 }
    );
  }

  // Derive origin for the self-referential Python endpoint call
  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    "localhost:3000";
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  const origin = `${proto}://${host}`;

  try {
    // Prefer the Python scraper (curl_cffi / Playwright). Fall back to the TS
    // scraper only where it can actually work.
    const python = await tryPythonScraper(source, origin, query, location);
    const pythonPostings = python.postings;

    // Indeed's TS scraper is a plain HTTP fetch that Cloudflare answers with a
    // 403; running it after Python came up empty just turned "no results" into a
    // misleading "HTTP 403". Report what actually happened instead.
    if (!pythonPostings && source === "indeed") {
      const outcome = describeIndeedOutcome({
        reason: python.reason,
        timedOut: python.timedOut,
        timeoutMs: python.timeoutMs,
        stderrTail: python.stderrTail,
        onVercel: process.env.VERCEL === "1",
      });
      if (outcome.ok) {
        // The check cleared; Indeed just had no new jobs for this search.
        return NextResponse.json({
          ok: true,
          source,
          label,
          fetched: 0,
          count: 0,
          inserted: 0,
          engine: "python",
          reason: python.reason,
          durationMs: Date.now() - start,
        });
      }
      return NextResponse.json({
        ok: false,
        source,
        label,
        count: 0,
        inserted: 0,
        engine: python.timedOut ? "timeout" : "blocked",
        reason: python.reason,
        durationMs: Date.now() - start,
        error: outcome.error,
      });
    }

    const raw = pythonPostings ?? (await scraper.fetch(200, query, location));

    const filtered = filterTechPostings(raw);
    const { scraped, inserted } = await ingestPostings(filtered);
    return NextResponse.json({
      ok: true,
      source,
      label,
      fetched: raw.length,
      count: scraped,
      inserted,
      engine: pythonPostings ? "python" : "typescript",
      durationMs: Date.now() - start,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({
      ok: false,
      source,
      label,
      count: 0,
      inserted: 0,
      durationMs: Date.now() - start,
      error: message,
    });
  }
}
