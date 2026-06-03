import { env, FILTER_BATCH_SIZE } from "@/lib/env";
import { callOpenAIJson } from "@/lib/llm/client";
import {
  buildFilterPrompt,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
} from "@/lib/llm/prompts";
import {
  FALLBACK_FILTERED,
  filteredJobJsonSchema,
  parseFilteredBatch,
} from "@/lib/llm/schemas";
import { sha256Hex } from "@/lib/hash";
import { memory } from "./memory";
import { logEvent } from "./observability";

export async function filterPendingPostings(
  limit: number
): Promise<{ processed: number; succeeded: number }> {
  const pending = await memory.listUnfilteredPostings(limit);
  let processed = 0;
  let succeeded = 0;

  for (let i = 0; i < pending.length; i += FILTER_BATCH_SIZE) {
    const batch = pending.slice(i, i + FILTER_BATCH_SIZE);
    const postings = batch.map((b) => b.posting);
    const inputHash = sha256Hex(
      JSON.stringify(postings.map((p) => ({ id: p.id, title: p.title })))
    );

    const cached = await memory.getCachedLlm(env.OPENAI_FILTER_MODEL, inputHash);
    let parsed = cached ? parseFilteredBatch(cached) : null;

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
            }))
          ),
          jsonSchema: filteredJobJsonSchema as Record<string, unknown>,
        });
        parsed = parseFilteredBatch(raw);
        if (parsed) {
          await memory.setCachedLlm(env.OPENAI_FILTER_MODEL, inputHash, raw as Record<string, unknown>);
        }
      } catch (error) {
        await logEvent("error", "LLM filter call failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    for (let j = 0; j < batch.length; j++) {
      processed++;
      const posting = batch[j].posting;
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
    }
  }

  return { processed, succeeded };
}

export { parseFilteredBatch, FALLBACK_FILTERED };
