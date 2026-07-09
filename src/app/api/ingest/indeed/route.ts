import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { ingestPostings } from "@/lib/agent/perception";
import { filterVaPostings } from "@/lib/agent/va-filter";
import { filterPendingPostings } from "@/lib/agent/reasoning";
import { htmlToText } from "@/lib/scrapers/fetch-description";
import type { RawPosting } from "@/types";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The bookmarklet runs on indeed.com and POSTs cross-origin, so allow CORS.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

interface IndeedCard {
  jobkey?: string;
  title?: string;
  company?: string;
  city?: string;
  state?: string;
  snippet?: string;
  pubDate?: number;
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS });
}

/**
 * Ingest Indeed job cards scraped by the browser bookmarklet from the user's own
 * (Cloudflare-passed) session, then run the relevancy filter. This sidesteps
 * Indeed's bot-blocking of server-side/headless scrapes.
 *
 * Body (sent as text/plain to avoid a CORS preflight):
 *   { token: "<ADMIN_TOKEN>", jobs: IndeedCard[] }
 */
export async function POST(request: Request) {
  let payload: { token?: string; jobs?: IndeedCard[] };
  try {
    payload = JSON.parse(await request.text());
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const token = (payload.token ?? "").trim();
  if (!token || (token !== env.ADMIN_TOKEN.trim() && token !== env.CRON_SECRET.trim())) {
    return json({ ok: false, error: "Unauthorized — bookmarklet token invalid" }, 401);
  }

  const cards = Array.isArray(payload.jobs) ? payload.jobs : [];
  const postings: RawPosting[] = cards
    .filter((c) => c.jobkey && c.title)
    .map((c) => ({
      source: "indeed" as const,
      externalId: String(c.jobkey),
      url: `https://www.indeed.com/viewjob?jk=${c.jobkey}`,
      title: String(c.title),
      company: c.company || "Unknown company",
      location: [c.city, c.state].filter(Boolean).join(", ") || "Remote",
      description: htmlToText(c.snippet || String(c.title)),
      postedAt: c.pubDate ? new Date(c.pubDate) : null,
      raw: c as Record<string, unknown>,
    }));

  if (postings.length === 0) {
    return json({ ok: false, error: "No usable Indeed cards in payload" }, 400);
  }

  const vaFiltered = filterVaPostings(postings);
  const { scraped, inserted } = await ingestPostings(vaFiltered);

  // Score the freshly ingested Indeed jobs (source-scoped, bounded to fit budget).
  let relevant = 0;
  try {
    const step = await filterPendingPostings(60, {
      source: "indeed",
      maxBatches: 6,
      concurrency: 1,
      llmTimeoutMs: 20_000,
      llmMaxRetries: 1,
    });
    relevant = step.newMatches.length;
  } catch {
    // Ingestion still succeeded; jobs can be filtered later from Settings.
  }

  return json({ ok: true, received: cards.length, ingested: scraped, inserted, relevant });
}
