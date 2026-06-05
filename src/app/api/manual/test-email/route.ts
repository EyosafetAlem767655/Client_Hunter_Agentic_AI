import { NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/auth";
import { sendTestEmail } from "@/lib/email/digest";

export const maxDuration = 30;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

  const result = await sendTestEmail();
  return NextResponse.json({
    ok: result.sent,
    to: result.to,
    error: result.error,
    hint: result.sent
      ? "Check your inbox (and spam folder) for the test message."
      : "Common causes: GMAIL_USER mismatched with GMAIL_APP_PASSWORD; 2FA not enabled on the Google account; app password regenerated.",
  });
}
