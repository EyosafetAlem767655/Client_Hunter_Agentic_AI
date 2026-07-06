import { NextRequest, NextResponse } from "next/server";
import { listAllFeedback } from "@/lib/db/queries";
import { verifyManualAuth } from "@/lib/auth";
import { runTrainingOnFeedback, saveTrainingResult } from "@/lib/llm/train";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

    const result = await runTrainingOnFeedback(feedback);
    await saveTrainingResult(result, feedback.length);

    return NextResponse.json({
      ok: true,
      count: feedback.length,
      summary: result.summary,
      disqualifiers: result.disqualifiers,
      positiveSignals: result.positiveSignals,
      additionalContext: result.additionalContext,
      trainedAt: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Error" },
      { status: 500 }
    );
  }
}
