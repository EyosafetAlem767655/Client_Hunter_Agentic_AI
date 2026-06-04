import { runPythonScrapers } from "@/lib/scraper/python-client";
import type { RawPosting } from "@/types";
import { filterNewPostings, memory } from "./memory";
import { logEvent } from "./observability";

export async function ingestPostings(
  postings: RawPosting[]
): Promise<{ scraped: number; inserted: number }> {
  const novel = await filterNewPostings(postings);
  let inserted = 0;
  for (const posting of novel) {
    await memory.upsertJobPosting(posting);
    inserted++;
  }
  return { scraped: postings.length, inserted };
}

export async function runPerception(limit: number): Promise<{
  scraped: number;
  inserted: number;
  engine: "python";
}> {
  await logEvent("info", "Starting Python scrapers");

  const result = await runPythonScrapers(limit);

  for (const source of result.sources) {
    if (source.ok) {
      await logEvent("info", `Python scraper ${source.source} returned ${source.count ?? 0} postings`);
    } else {
      const isRateLimit =
        source.error?.includes("403") || source.error?.includes("429");
      await logEvent(isRateLimit ? "warn" : "error", `Python scraper ${source.source} failed`, {
        error: source.error,
      });
    }
  }

  const { scraped, inserted } = await ingestPostings(result.postings);

  await logEvent("info", "Python scrape complete", { scraped, inserted });

  return { scraped, inserted, engine: "python" };
}
