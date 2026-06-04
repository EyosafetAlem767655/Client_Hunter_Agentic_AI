import { NextResponse } from "next/server";
import { runScrapePipeline } from "@/lib/agent/orchestrator";
import { verifyManualAuth } from "@/lib/auth";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!verifyManualAuth(request)) {
    return NextResponse.json(
      {
        error:
          "Unauthorized — paste your ADMIN_TOKEN (or CRON_SECRET) in Settings → Admin token",
      },
      { status: 401 }
    );
  }

  const summary = await runScrapePipeline();
  return NextResponse.json(summary);
}
