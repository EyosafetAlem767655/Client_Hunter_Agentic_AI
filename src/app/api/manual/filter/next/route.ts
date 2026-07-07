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
  // 8 jobs per batch keeps each OpenAI call small and well under the 60 s limit.
  // The UI loops this endpoint until done:true so all scraped jobs get processed.
  const n = Math.max(1, Math.min(24, Number(url.searchParams.get("n") ?? 8)));
  // Optional source scope — clicking "Indeed" filters only Indeed jobs.
  const source = url.searchParams.get("source") ?? undefined;
  const started = Date.now();

  try {
    const step = await filterPendingPostings(n, {
      maxBatches: 1,
      concurrency: 1,
      llmTimeoutMs: 35_000,
      llmMaxRetries: 2,
      throwOnLlmFailure: true,
      source,
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
          "Ensure OPENAI_API_KEY is set in Vercel Environment Variables. The filter sends jobs to GPT-4o-mini in small batches.",
      },
      { status: 200 }
    );
  }
}
