import { NextRequest, NextResponse } from "next/server";
import { listAllFeedback, setSetting } from "@/lib/db/queries";
import { verifyManualAuth } from "@/lib/auth";
import { callOpenAIJson } from "@/lib/llm/client";
import { buildTrainPrompt } from "@/lib/llm/prompts";
import { env } from "@/lib/env";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface TrainResult {
  summary: string;
  disqualifiers: string[];
  positiveSignals: string[];
  additionalContext: string;
}

const trainJsonSchema = {
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

export async function POST(req: NextRequest) {
  if (!verifyManualAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const feedback = await listAllFeedback();
    if (feedback.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No feedback entries found. Rate some jobs first." },
        { status: 400 }
      );
    }

    const result = await callOpenAIJson<TrainResult>({
      model: env.OPENAI_FILTER_MODEL,
      system:
        "You analyze job filter feedback to extract specific, actionable new filtering rules. Be concrete.",
      user: buildTrainPrompt(feedback),
      jsonSchema: trainJsonSchema as Record<string, unknown>,
      timeoutMs: 30_000,
      maxRetries: 2,
    });

    const learnings = {
      ...result,
      trainedAt: new Date().toISOString(),
      feedbackCount: feedback.length,
    };

    await setSetting("prompt_learnings", JSON.stringify(learnings));

    return NextResponse.json({
      ok: true,
      count: feedback.length,
      summary: result.summary,
      disqualifiers: result.disqualifiers,
      positiveSignals: result.positiveSignals,
      additionalContext: result.additionalContext,
      trainedAt: learnings.trainedAt,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Error" },
      { status: 500 }
    );
  }
}
