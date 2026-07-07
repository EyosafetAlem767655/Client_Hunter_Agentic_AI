import { NextResponse } from "next/server";
import { runScrapePipelineForSource } from "@/lib/agent/orchestrator";
import { sendDailyDigest } from "@/lib/email/digest";
import { memory } from "@/lib/agent/memory";
import { env } from "@/lib/env";
import { verifyCronAuth } from "@/lib/auth";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function resolveDryRun(): Promise<boolean> {
  const dbSetting = await memory.getSetting("DRY_RUN");
  if (dbSetting !== null) return dbSetting === "true";
  return env.DRY_RUN;
}

export async function GET(request: Request) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = Date.now();

  // Run LinkedIn with 45 s budget — leaves time for digest + response
  const linkedin = await runScrapePipelineForSource("linkedin", {
    timeoutMs: 45_000,
    filterLimit: 30,
  });

  // Fire Indeed as a second independent function invocation (fire-and-forget).
  // The request is dispatched now; Vercel creates a new function instance for
  // it with its own 60 s budget, independent of this function's timeout.
  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";
  void fetch(`${base}/api/cron/scrape/indeed`, {
    headers: { Authorization: request.headers.get("Authorization") ?? "" },
  }).catch(() => {});

  // Send daily digest if budget allows
  const elapsed = Date.now() - start;
  if (elapsed < 52_000) {
    const dryRun = await resolveDryRun();
    await sendDailyDigest({ dryRun }).catch(() => {});
  }

  return NextResponse.json({
    linkedin,
    indeed: "dispatched",
    durationMs: Date.now() - start,
  });
}
