import { NextResponse } from "next/server";
import { runOutreachPipeline } from "@/lib/agent/orchestrator";
import { verifyManualAuth } from "@/lib/auth";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!verifyManualAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await runOutreachPipeline();
  return NextResponse.json(summary);
}
