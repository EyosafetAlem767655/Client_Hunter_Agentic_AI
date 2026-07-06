import { NextResponse } from "next/server";
import { listAllFeedback, getSetting, countNewFeedbackSince } from "@/lib/db/queries";
import { verifyCronAuth } from "@/lib/auth";
import { runTrainingOnFeedback, saveTrainingResult } from "@/lib/llm/train";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MIN_NEW_FEEDBACK = 3;

export async function GET(request: Request) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const learnedStr = await getSetting("prompt_learnings");
    let trainedAt = new Date(0); // epoch = never trained
    if (learnedStr) {
      const parsed = JSON.parse(learnedStr) as { trainedAt?: string };
      if (parsed.trainedAt) trainedAt = new Date(parsed.trainedAt);
    }

    const pendingCount = await countNewFeedbackSince(trainedAt);

    if (pendingCount < MIN_NEW_FEEDBACK) {
      return NextResponse.json({
        trained: false,
        pendingCount,
        reason: `threshold not met (need ${MIN_NEW_FEEDBACK}, have ${pendingCount})`,
      });
    }

    // Train on ALL feedback (not just the new ones) so model has full positive/negative context
    const feedback = await listAllFeedback();
    if (feedback.length === 0) {
      return NextResponse.json({ trained: false, pendingCount: 0, reason: "no feedback" });
    }

    const result = await runTrainingOnFeedback(feedback);
    await saveTrainingResult(result, feedback.length);

    return NextResponse.json({
      trained: true,
      pendingCount,
      feedbackTotal: feedback.length,
      summary: result.summary,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Training failed" },
      { status: 500 }
    );
  }
}
