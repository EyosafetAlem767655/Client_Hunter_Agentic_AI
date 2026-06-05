import { NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/auth";
import { sendDailyDigest } from "@/lib/email/digest";
import { memory } from "@/lib/agent/memory";
import { env } from "@/lib/env";

export const maxDuration = 30;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Send the daily VA digest email on demand. Decoupled from the scrape
 * pipeline so the user can fire it without re-running the scrape, and
 * so the manual scrape route stays under the Vercel Hobby 60 s ceiling.
 */
export async function POST(request: Request) {
  if (!verifyAdminAuth(request)) {
    return NextResponse.json(
      {
        error:
          "Unauthorized — paste your ADMIN_TOKEN in Settings → Admin token",
      },
      { status: 401 }
    );
  }
  try {
    const dbDry = await memory.getSetting("DRY_RUN");
    const dryRun = dbDry !== null ? dbDry === "true" : env.DRY_RUN;
    const result = await sendDailyDigest({ dryRun });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        hint: "Check Gmail credentials and Neon connectivity.",
      },
      { status: 200 }
    );
  }
}
