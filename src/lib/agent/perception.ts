import { getEnabledScrapers } from "@/lib/scrapers";
import type { RawPosting } from "@/types";
import { filterNewPostings, memory } from "./memory";
import { logEvent } from "./observability";

export async function runPerception(limit: number): Promise<{
  scraped: number;
  inserted: number;
}> {
  const scrapers = getEnabledScrapers();
  const results = await Promise.allSettled(
    scrapers.map((s) => s.fetch(limit))
  );

  const allPostings: RawPosting[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const scraper = scrapers[i];
    if (result.status === "fulfilled") {
      allPostings.push(...result.value);
      await logEvent("info", `Scraper ${scraper.source} returned ${result.value.length} postings`);
    } else {
      const err = result.reason;
      const message =
        err instanceof Error ? err.message : String(err);
      const isRateLimit =
        message.includes("403") || message.includes("429");
      await logEvent(isRateLimit ? "warn" : "error", `Scraper ${scraper.source} failed`, {
        error: message,
      });
    }
  }

  const novel = await filterNewPostings(allPostings);
  let inserted = 0;
  for (const posting of novel) {
    await memory.upsertJobPosting(posting);
    inserted++;
  }

  return { scraped: allPostings.length, inserted };
}
