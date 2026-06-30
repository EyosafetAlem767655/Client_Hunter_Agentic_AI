import { env, FILTER_BATCH_SIZE, LLM_FILTER_CONCURRENCY } from "@/lib/env";
import { callOpenAIJson } from "@/lib/llm/client";
import {
  buildFilterPrompt,
  FeedbackExample,
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
};

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
}

async function processBatch(
  postings: Posting[],
  options: FilterBatchOptions = {},
  feedbackExamples: FeedbackExample[] = []
): Promise<BatchOutcome> {
  const inputHash = sha256Hex(
    JSON.stringify(postings.map((p) => ({ id: p.id, title: p.title })))
  );
  const cached = await memory.getCachedLlm(env.OPENAI_FILTER_MODEL, inputHash);
  let parsed = cached ? parseFilteredBatch(cached) : null;
  let llmFailed = false;

  if (!parsed) {
    try {
      const raw = await callOpenAIJson<unknown>({
        model: env.OPENAI_FILTER_MODEL,
        system: SYSTEM_PROMPT,
        user: buildFilterPrompt(
          postings.map((p) => ({
            title: p.title,
            company: p.company,
            location: p.location,
            description: p.description,
          })),
          feedbackExamples
        ),
        jsonSchema: filteredJobJsonSchema as Record<string, unknown>,
        timeoutMs: options.llmTimeoutMs,
        maxRetries: options.llmMaxRetries,
      });
      parsed = parseFilteredBatch(raw);
      if (parsed) {
        await memory.setCachedLlm(
          env.OPENAI_FILTER_MODEL,
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
      llmModel: env.OPENAI_FILTER_MODEL,
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
  const [pending, feedbackExamples] = await Promise.all([
    memory.listUnfilteredPostings(limit),
    memory.getFeedbackExamples(),
  ]);

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
    // Sequential with optional rate-limit delay between OpenAI calls
    for (let i = 0; i < selectedBatches.length; i++) {
      if (i > 0 && delayMs > 0) await sleep(delayMs);
      outcomes.push(await processBatch(selectedBatches[i], options, feedbackExamples as FeedbackExample[]));
    }
  } else {
    const parallel = await withConcurrency(
      selectedBatches,
      options.concurrency ?? LLM_FILTER_CONCURRENCY,
      (batch) => processBatch(batch, options, feedbackExamples as FeedbackExample[])
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
