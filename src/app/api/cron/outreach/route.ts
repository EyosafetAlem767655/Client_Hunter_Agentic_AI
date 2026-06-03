import { NextResponse } from "next/server";
import { runOutreachPipeline } from "@/lib/agent/orchestrator";
import { verifyCronAuth } from "@/lib/auth";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await runOutreachPipeline();
  return NextResponse.json(summary);
}
