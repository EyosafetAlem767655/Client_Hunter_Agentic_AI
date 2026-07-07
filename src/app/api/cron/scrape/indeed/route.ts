import { NextResponse } from "next/server";
import { runScrapePipelineForSource } from "@/lib/agent/orchestrator";
import { verifyCronAuth } from "@/lib/auth";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Dedicated Indeed scrape endpoint — invoked as a fire-and-forget background
// call from /api/cron/scrape so Indeed gets its own independent 60 s budget.
export async function GET(request: Request) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runScrapePipelineForSource("indeed", {
    timeoutMs: 50_000,
    filterLimit: 50,
  });

  return NextResponse.json(result);
}
