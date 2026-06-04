import { getEnabledScrapers } from "@/lib/scrapers";
import type { RawPosting } from "@/types";

export interface NodeScrapeResult {
  postings: RawPosting[];
  scraped: number;
  sources: Array<{ source: string; ok: boolean; count?: number; error?: string }>;
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

  const perSource = Math.max(10, Math.ceil(limit));

  const results = await Promise.allSettled(
    scrapers.map(async (s) => {
      const batch = await s.fetch(perSource);
      return { source: s.source, batch };
    })
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const sourceName = scrapers[i].source;
    if (r.status === "fulfilled") {
      all.push(...r.value.batch);
      sources.push({ source: sourceName, ok: true, count: r.value.batch.length });
    } else {
      const error = r.reason instanceof Error ? r.reason.message : String(r.reason);
      sources.push({ source: sourceName, ok: false, error });
    }
  }

  return {
    postings: all.slice(0, limit * 3),
    scraped: all.length,
    sources,
  };
}
