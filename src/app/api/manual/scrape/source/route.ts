import { NextResponse } from "next/server";
import { verifyManualAuth } from "@/lib/auth";
import { scraperForSource, ENABLED_SOURCES } from "@/lib/scrapers";
import { jobSourceLabel } from "@/lib/job-sources";
import { ingestPostings } from "@/lib/agent/perception";
import { filterVaPostings } from "@/lib/agent/va-filter";
import type { JobSource } from "@/types";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!verifyManualAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { source?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const source = body.source as JobSource | undefined;
  if (!source || !ENABLED_SOURCES.includes(source)) {
    return NextResponse.json(
      { error: `Unknown or disabled source: ${source}` },
      { status: 400 }
    );
  }

  const scraper = scraperForSource(source);
  if (!scraper) {
    return NextResponse.json({ error: `No scraper for source: ${source}` }, { status: 400 });
  }

  const label = jobSourceLabel(source);
  const start = Date.now();

  try {
    // Generous limit — each source gets its own 60 s Vercel budget
    const raw = await scraper.fetch(200);
    const filtered = filterVaPostings(raw);
    const { scraped, inserted } = await ingestPostings(filtered);
    return NextResponse.json({
      ok: true,
      source,
      label,
      fetched: raw.length,
      count: scraped,
      inserted,
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
