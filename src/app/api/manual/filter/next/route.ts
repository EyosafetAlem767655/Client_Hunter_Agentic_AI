import { NextResponse } from "next/server";
import { verifyManualAuth } from "@/lib/auth";
import { filterPendingPostings } from "@/lib/agent/medical-filter";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!verifyManualAuth(request)) {
    return NextResponse.json(
      {
        error:
          "Unauthorized - paste your ADMIN_TOKEN (or CRON_SECRET) in Settings -> Admin token",
      },
      { status: 401 }
    );
  }

  const url = new URL(request.url);
  // Default page-size dropped 12 → 8 to match FILTER_BATCH_SIZE so each
  // OpenAI call is small enough to come back well under the timeout.
  const n = Math.max(1, Math.min(24, Number(url.searchParams.get("n") ?? 8)));
  const started = Date.now();

  try {
    // 35 s OpenAI timeout × 2 retries (with 500 ms / 1 s exponential backoff)
    // ≈ 50 s worst case, which fits inside the 60 s function budget. OpenAI
    // can take 20–25 s for structured outputs on gpt-4o-mini under load,
    // and the previous 20 s × 1 retry was hitting that ceiling.
    const step = await filterPendingPostings(n, {
      maxBatches: 1,
      concurrency: 1,
      llmTimeoutMs: 35_000,
      llmMaxRetries: 2,
      throwOnLlmFailure: true,
    });
    return NextResponse.json({
      ok: true,
      step,
      done: step.processed === 0,
      durationMs: Date.now() - started,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        hint:
          "The scrape already stores jobs. This endpoint only runs the OpenAI relevance filter in a small batch.",
      },
      { status: 200 }
    );
  }
}
