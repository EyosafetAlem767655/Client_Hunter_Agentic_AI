import { NextResponse } from "next/server";
import { verifyManualAuth } from "@/lib/auth";
import { filterPendingPostings } from "@/lib/agent/reasoning";

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
  const n = Math.max(1, Math.min(24, Number(url.searchParams.get("n") ?? 12)));
  const started = Date.now();

  try {
    const step = await filterPendingPostings(n, {
      maxBatches: 1,
      concurrency: 1,
      llmTimeoutMs: 20_000,
      llmMaxRetries: 1,
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
