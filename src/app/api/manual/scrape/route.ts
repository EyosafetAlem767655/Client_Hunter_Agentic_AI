import { NextResponse } from "next/server";
import { runScrapePipeline } from "@/lib/agent/orchestrator";
import { verifyAdminAuth } from "@/lib/auth";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!verifyAdminAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await runScrapePipeline();
  return NextResponse.json(summary);
}
