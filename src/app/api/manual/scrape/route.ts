import { NextResponse } from "next/server";
import { runScrapePipeline } from "@/lib/agent/orchestrator";
import { verifyManualAuth } from "@/lib/auth";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

  try {
    // No digest from the manual path — keeps wall-time well under Vercel
    // Hobby's 60 s ceiling. The user can fire /api/manual/digest from
    // Settings whenever they want the email summary; the 06:00 UTC cron
    // also still sends it automatically.
    const summary = await runScrapePipeline({
      sendDigest: false,
      filterLimit: 0,
    });
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    // Return 200 with diagnostic info instead of 500 — the UI shows it.
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error("Manual scrape unhandled error", message, stack);
    return NextResponse.json(
      {
        ok: false,
        error: message,
        hint:
          "Pipeline threw before completing. Check Vercel function logs for the stack trace. Common causes: missing env vars (OPENAI_API_KEY, DATABASE_URL, GMAIL_APP_PASSWORD) or Neon connection limit reached.",
      },
      { status: 200 }
    );
  }
}
