import { listAllFeedback, setSetting } from "@/lib/db/queries";
import { callGeminiJson } from "@/lib/llm/client";
import { buildTrainPrompt } from "@/lib/llm/prompts";
import { env } from "@/lib/env";

export interface TrainResult {
  summary: string;
  disqualifiers: string[];
  positiveSignals: string[];
  additionalContext: string;
}

const TRAIN_JSON_SCHEMA = {
  type: "object" as const,
  properties: {
    summary: { type: "string" as const },
    disqualifiers: { type: "array" as const, items: { type: "string" as const } },
    positiveSignals: { type: "array" as const, items: { type: "string" as const } },
    additionalContext: { type: "string" as const },
  },
  required: ["summary", "disqualifiers", "positiveSignals", "additionalContext"],
  additionalProperties: false,
};

export async function runTrainingOnFeedback(
  feedback: Awaited<ReturnType<typeof listAllFeedback>>
): Promise<TrainResult> {
  return callGeminiJson<TrainResult>({
    model: env.GEMINI_MODEL,
    system:
      "You analyze job filter feedback to extract specific, actionable new filtering rules. Be concrete.",
    user: buildTrainPrompt(feedback),
    jsonSchema: TRAIN_JSON_SCHEMA as Record<string, unknown>,
    timeoutMs: 30_000,
    maxRetries: 2,
  });
}

export async function saveTrainingResult(
  result: TrainResult,
  feedbackCount: number
): Promise<void> {
  await setSetting(
    "prompt_learnings",
    JSON.stringify({
      ...result,
      trainedAt: new Date().toISOString(),
      feedbackCount,
    })
  );
}
