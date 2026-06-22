import { getEnabledScrapers } from "@/lib/scrapers";
import { jobSourceLabel } from "@/lib/job-sources";
import { scraperStatusFromError } from "@/lib/scrapers/errors";
import type { RawPosting, ScrapeSourceStatus } from "@/types";

export interface NodeScrapeResult {
  postings: RawPosting[];
  scraped: number;
  sources: ScrapeSourceStatus[];
}

/**
 * Run the TypeScript scrapers in-process. This is the most reliable path on
 * Vercel — no Python runtime, no self-fetch, no extra serverless cold start.
 * Each scraper is wrapped so one failing source never aborts the whole run.
 */
export async function runNodeScrapers(limit: number): Promise<NodeScrapeResult> {
  const scrapers = getEnabledScrapers();
  const all: RawPosting[] = [];
  const sources: NodeScrapeResult["sources"] = [];

  const perSource = perSourceLimit(limit, scrapers.length);
  const sourceTimeoutMs = perSourceTimeoutMs();

  const results = await Promise.allSettled(
    scrapers.map(async (s) => {
      const batch = await s.fetchWithinBudget(perSource, sourceTimeoutMs);
      return { source: s.source, batch };
    })
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const sourceName = scrapers[i].source;
    if (r.status === "fulfilled") {
      all.push(...r.value.batch);
      sources.push({
        source: sourceName,
        label: jobSourceLabel(sourceName),
        ok: true,
        status: "scraped",
        count: r.value.batch.length,
      });
    } else {
      const error = r.reason instanceof Error ? r.reason.message : String(r.reason);
      sources.push({
        source: sourceName,
        label: jobSourceLabel(sourceName),
        ok: false,
        status: scraperStatusFromError(r.reason),
        count: 0,
        error,
      });
    }
  }

  // Return everything — perception filters down to VA + US/EU, then the
  // memory layer dedupes against what's already in the DB. Slicing here
  // would silently throw away matches.
  return { postings: all, scraped: all.length, sources };
}

function perSourceLimit(limit: number, sourceCount: number): number {
  const configured = Number(process.env.SCRAPER_PER_SOURCE_LIMIT);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.max(1, Math.floor(configured));
  }
  if (process.env.VERCEL === "1") {
    return Math.max(8, Math.ceil(limit / Math.max(1, sourceCount)));
  }
  return Math.max(50, Math.ceil(limit));
}

function perSourceTimeoutMs(): number {
  const configured = Number(process.env.SCRAPER_SOURCE_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return process.env.VERCEL === "1" ? 8_000 : 15_000;
}
