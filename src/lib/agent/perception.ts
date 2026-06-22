import { runNodeScrapers } from "@/lib/scraper/node-runner";
import { runPythonScrapers } from "@/lib/scraper/python-client";
import { jobSourceLabel } from "@/lib/job-sources";
import type { RawPosting, ScrapeSourceStatus } from "@/types";
import { filterNewPostings, memory } from "./memory";
import { logEvent } from "./observability";
import { filterVaPostings } from "./va-filter";

type Engine = "node" | "python";

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

function pickEngine(): Engine {
  // On Vercel the Node-native scrapers are far more reliable than the Python
  // self-fetch path (no extra serverless cold-start, no inter-function HTTP).
  if (process.env.VERCEL === "1") return "node";
  // Allow opt-in for local Python testing
  if (process.env.SCRAPER_ENGINE === "python") return "python";
  // Default to Node everywhere — Python is now a fallback.
  return "node";
}

export async function runPerception(limit: number): Promise<{
  scraped: number;
  inserted: number;
  engine: Engine;
  sources: ScrapeSourceStatus[];
}> {
  const engine = pickEngine();
  await logEvent("info", `Starting ${engine} scrapers`);

    let result: {
      postings: RawPosting[];
      scraped: number;
      sources: ScrapeSourceStatus[];
    };

  try {
    if (engine === "node") {
      result = await runNodeScrapers(limit);
    } else {
      const python = await runPythonScrapers(limit);
      result = { ...python, sources: normalizeLegacySources(python.sources) };
    }
  } catch (primaryError) {
    const message =
      primaryError instanceof Error ? primaryError.message : String(primaryError);
    await logEvent("warn", `${engine} scraper failed, attempting fallback`, {
      error: message,
    });
    // Fallback: try the other engine before giving up
    try {
      result =
        engine === "node"
          ? await runPythonScrapers(limit).then((python) => ({
              ...python,
              sources: normalizeLegacySources(python.sources),
            }))
          : await runNodeScrapers(limit);
    } catch (fallbackError) {
      const fbMessage =
        fallbackError instanceof Error
          ? fallbackError.message
          : String(fallbackError);
      await logEvent("error", "All scrapers failed", {
        primary: message,
        fallback: fbMessage,
      });
      throw fallbackError;
    }
  }

  for (const source of result.sources) {
    if (source.ok) {
      await logEvent(
        "info",
        `${engine} scraper ${source.source} returned ${source.count ?? 0} postings`
      );
    } else {
      const isRateLimit =
        source.error?.includes("403") || source.error?.includes("429");
      await logEvent(
        isRateLimit ? "warn" : "error",
        `${engine} scraper ${source.source} failed`,
        { error: source.error }
      );
    }
  }

  // Filter for Virtual Assistant / customer-support roles aimed at US/Europe.
  const vaPostings = filterVaPostings(result.postings);
  await logEvent("info", "VA pre-filter complete", {
    total: result.postings.length,
    matched: vaPostings.length,
  });

  const { scraped, inserted } = await ingestPostings(vaPostings);

  await logEvent("info", `${engine} scrape complete`, {
    scraped,
    inserted,
    totalFetched: result.postings.length,
  });

  return { scraped, inserted, engine, sources: result.sources };
}

function normalizeLegacySources(
  sources: Array<{ source: string; ok: boolean; count?: number; error?: string }>
): ScrapeSourceStatus[] {
  return sources.map((source) => ({
    source: source.source as RawPosting["source"],
    label: jobSourceLabel(source.source),
    ok: source.ok,
    status: source.ok ? "scraped" : "rejected",
    count: source.count ?? 0,
    error: source.error,
  }));
}
