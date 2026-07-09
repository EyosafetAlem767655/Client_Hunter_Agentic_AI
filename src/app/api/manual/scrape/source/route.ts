import { spawn } from "node:child_process";
import path from "node:path";
import { NextResponse } from "next/server";
import { verifyManualAuth } from "@/lib/auth";
import { scraperForSource, ENABLED_SOURCES } from "@/lib/scrapers";
import { jobSourceLabel } from "@/lib/job-sources";
import { ingestPostings } from "@/lib/agent/perception";
import { filterVaPostings } from "@/lib/agent/va-filter";
import { parseIngestPostings } from "@/lib/scraper/python-client";
import type { JobSource, RawPosting } from "@/types";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ── Local dev: spawn Python as a subprocess (Python endpoints only run on Vercel)

function tryPythonSubprocess(source: string, query?: string): Promise<RawPosting[] | null> {
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
    const timer = setTimeout(() => { proc.kill(); finish(null); }, 55_000);
    const args = query ? [scriptPath, source, query] : [scriptPath, source];
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
  query?: string
): Promise<RawPosting[] | null> {
  const secret = process.env.CRON_SECRET ?? process.env.ADMIN_TOKEN ?? "";
  try {
    const res = await fetch(`${origin}/api/py/scrape_jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(query ? { source, query } : { source }),
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
  query?: string
): Promise<RawPosting[] | null> {
  if (process.env.VERCEL !== "1") {
    // Local dev: spawn Python directly — the /api/py endpoint is Vercel-only
    return tryPythonSubprocess(source, query);
  }
  return tryPythonVercel(source, origin, query);
}

export async function POST(request: Request) {
  if (!verifyManualAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { source?: string; query?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const source = body.source as JobSource | undefined;
  const query = typeof body.query === "string" && body.query.trim() ? body.query.trim() : undefined;
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

  // Derive origin for the self-referential Python endpoint call
  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    "localhost:3000";
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  const origin = `${proto}://${host}`;

  try {
    // Prefer Python Playwright scraper — falls back to TS on any failure
    const pythonPostings = await tryPythonScraper(source, origin, query);
    const raw = pythonPostings ?? (await scraper.fetch(200, query));

    const filtered = filterVaPostings(raw);
    const { scraped, inserted } = await ingestPostings(filtered);
    return NextResponse.json({
      ok: true,
      source,
      label,
      fetched: raw.length,
      count: scraped,
      inserted,
      engine: pythonPostings ? "playwright" : "typescript",
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
