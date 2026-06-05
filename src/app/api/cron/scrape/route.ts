import { NextResponse } from "next/server";
import { runScrapePipeline } from "@/lib/agent/orchestrator";
import { verifyCronAuth } from "@/lib/auth";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Cron runs once a day at 06:00 UTC — fire the digest as part of this
  // run so the user gets the daily summary email automatically.
  const summary = await runScrapePipeline({ sendDigest: true });
  return NextResponse.json(summary);
}
