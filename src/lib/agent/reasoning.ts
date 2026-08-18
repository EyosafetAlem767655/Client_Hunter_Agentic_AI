import { env, FILTER_BATCH_SIZE, LLM_FILTER_CONCURRENCY } from "@/lib/env";
import { callGeminiJson } from "@/lib/llm/client";
import {
  buildFilterPrompt,
  FeedbackExample,
  PromptLearnings,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
} from "@/lib/llm/prompts";
import {
  FALLBACK_FILTERED,
  filteredJobJsonSchema,
  parseFilteredBatch,
} from "@/lib/llm/schemas";
import { sha256Hex } from "@/lib/hash";
import { sleep } from "@/lib/utils";
import { memory } from "./memory";
import { logEvent } from "./observability";
import { fetchFullDescription, htmlToText } from "@/lib/scrapers/fetch-description";
import { updateJobPostingDescription } from "@/lib/db/queries";

export interface FilterRunResult {
  processed: number;
  succeeded: number;
  /** Newly-classified relevant matches in this run (used for instant alerts). */
  newMatches: NewMatch[];
}

export interface NewMatch {
  postingId: number;
  title: string;
  company: string;
  location: string;
  url: string;
  score: number;
  roleCategory: string | null;
  fitReason: string | null;
  estimatedSalaryRange: string | null;
}

type Posting = {
  id: number;
  title: string;
  company: string;
  location: string;
  description: string;
  url: string;
  source: string;
};

// Scrapers store a short stub description (e.g. "Title at Company") — the full
// text only lives on each posting's detail page. Anything under this length is
// treated as a stub worth re-fetching before we ask the LLM to judge it.
const STUB_DESCRIPTION_MAX = 400;

// Bound how many detail-page fetches run at once so a batch stays well under
// the 60 s route budget even if some pages are slow.
const DESCRIPTION_FETCH_CONCURRENCY = 5;

/**
 * Normalize each posting's description before the LLM sees it, so the model and
 * the job-detail UI get the same clean prose:
 *  - stubs from a fetchable (non-LinkedIn) source: pull the full detail page,
 *  - any description: strip HTML (Indeed snippets, legacy rows) to plain text.
 * Persists the cleaned text and mutates `postings` in place; never throws.
 */
async function enrichBatchDescriptions(postings: Posting[]): Promise<void> {
  await withConcurrency(postings, DESCRIPTION_FETCH_CONCURRENCY, async (posting) => {
    try {
      let text = posting.description ?? "";

      const fetchable =
        posting.source !== "linkedin" && /^https?:\/\//.test(posting.url ?? "");
      if (fetchable && text.length < STUB_DESCRIPTION_MAX) {
        const full = await fetchFullDescription(posting.url, posting.source);
        if (full && full.length > text.length + 50) text = full;
      }

      // Strip any HTML to readable prose (no-op when already clean).
      const clean = htmlToText(text);
      if (clean && clean !== posting.description) {
        posting.description = clean;
        await updateJobPostingDescription(posting.id, clean);
      }
    } catch {
      // Leave as-is — the LLM still scores from title/company.
    }
  });
}

interface BatchOutcome {
  newMatches: NewMatch[];
  processed: number;
  succeeded: number;
}



interface FilterBatchOptions {
  llmTimeoutMs?: number;
  llmMaxRetries?: number;
  throwOnLlmFailure?: boolean;
}

export interface FilterPendingOptions extends FilterBatchOptions {
  maxBatches?: number;
  concurrency?: number;
  /** Milliseconds to wait between sequential batch calls to respect rate limits. */
  batchDelayMs?: number;
  /** Restrict filtering to a single job source (e.g. "indeed", "linkedin"). */
  source?: string;
}

async function processBatch(
  postings: Posting[],
  options: FilterBatchOptions = {},
  feedbackExamples: FeedbackExample[] = [],
  learnedRules?: PromptLearnings
): Promise<BatchOutcome> {
  // Pull full descriptions for stubs first, so the LLM judges real text and the
  // cache key below reflects the description actually sent.
  await enrichBatchDescriptions(postings);

  const inputHash = sha256Hex(
    PROMPT_VERSION +
      JSON.stringify(
        postings.map((p) => ({
          id: p.id,
          title: p.title,
          // Length is enough to bust the cache when a stub is replaced by full
          // text, without bloating the hashed payload with the whole description.
          descLen: p.description?.length ?? 0,
        }))
      )
  );
  const cached = await memory.getCachedLlm(env.GEMINI_MODEL, inputHash);
  let parsed = cached ? parseFilteredBatch(cached) : null;
  let llmFailed = false;

  if (!parsed) {
    try {
      const raw = await callGeminiJson<unknown>({
        model: env.GEMINI_MODEL,
        system: SYSTEM_PROMPT,
        user: buildFilterPrompt(
          postings.map((p) => ({
            title: p.title,
            company: p.company,
            location: p.location,
            description: p.description,
          })),
          feedbackExamples,
          learnedRules
        ),
        jsonSchema: filteredJobJsonSchema as Record<string, unknown>,
        timeoutMs: options.llmTimeoutMs,
        maxRetries: options.llmMaxRetries,
      });
      parsed = parseFilteredBatch(raw);
      if (parsed) {
        await memory.setCachedLlm(
          env.GEMINI_MODEL,
          inputHash,
          raw as Record<string, unknown>
        );
      }
    } catch (error) {
      llmFailed = true;
      await logEvent("error", "LLM filter call failed", {
        error: error instanceof Error ? error.message : String(error),
        batchSize: postings.length,
      });
      if (options.throwOnLlmFailure) {
        throw error;
      }
    }
  }

  if (!parsed && llmFailed) {
    return { newMatches: [], processed: 0, succeeded: 0 };
  }

  const newMatches: NewMatch[] = [];
  let processed = 0;
  let succeeded = 0;

  for (let j = 0; j < postings.length; j++) {
    processed++;
    const posting = postings[j];
    const match = parsed?.results.find((r) => r.postingIndex === j);
    const job = match?.job ?? FALLBACK_FILTERED;

    if (!match) {
      await logEvent("warn", "LLM parse failure for posting", {
        postingId: posting.id,
      });
    }

    await memory.insertFilteredJob({
      postingId: posting.id,
      isRelevant: job.isRelevant,
      score: Math.round(job.score),
      roleCategory: job.roleCategory,
      fitReason: job.fitReason,
      suggestedRegions: job.suggestedRegions,
      estimatedSalaryRange: job.estimatedSalaryRange,
      llmModel: env.GEMINI_MODEL,
      promptVersion: PROMPT_VERSION,
    });
    succeeded++;

    if (job.isRelevant) {
      newMatches.push({
        postingId: posting.id,
        title: posting.title,
        company: posting.company,
        location: posting.location,
        url: posting.url,
        score: Math.round(job.score),
        roleCategory: job.roleCategory,
        fitReason: job.fitReason,
        estimatedSalaryRange: job.estimatedSalaryRange,
      });
    }
  }

  return { newMatches, processed, succeeded };
}

/** Run async tasks with a max concurrency. */
export async function withConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= items.length) return;
        results[idx] = await task(items[idx]);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

export async function filterPendingPostings(
  limit: number,
  options: FilterPendingOptions = {}
): Promise<FilterRunResult> {
  const [pending, feedbackExamples, learnedRulesStr] = await Promise.all([
    memory.listUnfilteredPostings(limit, options.source),
    memory.getFeedbackExamples(),
    memory.getSetting("prompt_learnings"),
  ]);
  const learnedRules = learnedRulesStr
    ? (JSON.parse(learnedRulesStr) as PromptLearnings)
    : undefined;

  const batches: Posting[][] = [];
  for (let i = 0; i < pending.length; i += FILTER_BATCH_SIZE) {
    batches.push(pending.slice(i, i + FILTER_BATCH_SIZE).map((b) => b.posting));
  }
  const selectedBatches =
    options.maxBatches && options.maxBatches > 0
      ? batches.slice(0, options.maxBatches)
      : batches;

  const delayMs = options.batchDelayMs ?? 0;
  const outcomes: BatchOutcome[] = [];

  if (delayMs > 0 || (options.concurrency ?? LLM_FILTER_CONCURRENCY) === 1) {
    // Sequential with optional rate-limit delay between Gemini calls
    for (let i = 0; i < selectedBatches.length; i++) {
      if (i > 0 && delayMs > 0) await sleep(delayMs);
      outcomes.push(await processBatch(selectedBatches[i], options, feedbackExamples as FeedbackExample[], learnedRules));
    }
  } else {
    const parallel = await withConcurrency(
      selectedBatches,
      options.concurrency ?? LLM_FILTER_CONCURRENCY,
      (batch) => processBatch(batch, options, feedbackExamples as FeedbackExample[], learnedRules)
    );
    outcomes.push(...parallel);
  }

  let processed = 0;
  let succeeded = 0;
  const newMatches: NewMatch[] = [];
  for (const o of outcomes) {
    processed += o.processed;
    succeeded += o.succeeded;
    newMatches.push(...o.newMatches);
  }

  return { processed, succeeded, newMatches };
}

export { parseFilteredBatch, FALLBACK_FILTERED };
