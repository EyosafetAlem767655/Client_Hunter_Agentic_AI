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
import { enqueueIndeedScrape } from "@/lib/indeed-queue";
import type { JobSource, RawPosting } from "@/types";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ── Local dev: spawn Python as a subprocess (Python endpoints only run on Vercel)

function tryPythonSubprocess(
  source: string,
  query?: string,
  location?: string
): Promise<RawPosting[] | null> {
  const scriptPath = path.join(process.cwd(), "api", "py", "scrape_jobs.py");
  return new Promise<RawPosting[] | null>((resolve) => {
    let stdout = "";
    let done = false;
    const finish = (result: RawPosting[] | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };
    // Indeed opens a real browser and may wait for a human to clear an "I am not
    // a robot" check, so it gets a much longer window than the API-only sources.
    const killMs = source === "indeed" ? 50_000 : 55_000;
    const timer = setTimeout(() => { proc.kill(); finish(null); }, killMs);
    // CLI is positional: <source> <query> <location>. Location only applies to
    // LinkedIn; pass it when we have a query (per-position scrapes always do).
    const args = query
      ? location
        ? [scriptPath, source, query, location]
        : [scriptPath, source, query]
      : [scriptPath, source];
    const proc = spawn("python", args, {
      cwd: process.cwd(),
      env: { ...process.env },
    });
    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.on("close", (code) => {
      if (code !== 0) { finish(null); return; }
      try {
        const data = JSON.parse(stdout) as { ok?: boolean; jobs?: unknown[] };
        if (!data.ok || !Array.isArray(data.jobs) || data.jobs.length === 0) {
          finish(null); return;
        }
        finish(parseIngestPostings(data.jobs) as RawPosting[]);
      } catch { finish(null); }
    });
    proc.on("error", () => finish(null));
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
): Promise<RawPosting[] | null> {
  if (process.env.VERCEL !== "1") {
    // Local dev: spawn Python directly — the /api/py endpoint is Vercel-only
    return tryPythonSubprocess(source, query, location);
  }
  return tryPythonVercel(source, origin, query, location);
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
    const pythonPostings = await tryPythonScraper(source, origin, query, location);

    // Indeed's TS scraper is a plain HTTP fetch that Cloudflare answers with a
    // 403; running it after Python came up empty just turned "no results" into a
    // misleading "HTTP 403". Report what actually happened instead.
    if (!pythonPostings && source === "indeed") {
      const onVercel = process.env.VERCEL === "1";
      return NextResponse.json({
        ok: false,
        source,
        label,
        count: 0,
        inserted: 0,
        engine: "blocked",
        durationMs: Date.now() - start,
        error: onVercel
          ? "Indeed can't be scraped from the server: clearing its Cloudflare check needs a real browser window, and there's no display on Vercel. Run the app locally to scrape Indeed."
          : "Indeed's Cloudflare check didn't clear. A Chromium window should have opened — if it asked you to verify, run this again and complete the check in that window.",
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
