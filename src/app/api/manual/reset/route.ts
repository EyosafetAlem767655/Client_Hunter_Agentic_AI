import { NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/auth";
import { resetPipelineData } from "@/lib/db/queries";

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

  // Require an explicit confirm so a stray request can't wipe data.
  const url = new URL(request.url);
  const confirm = url.searchParams.get("confirm");
  if (confirm !== "yes") {
    return NextResponse.json(
      {
        error:
          "Refusing to reset without ?confirm=yes — append it to the request URL to proceed.",
      },
      { status: 400 }
    );
  }

  try {
    const result = await resetPipelineData();
    return NextResponse.json({
      ok: true,
      message:
        "All pipeline data wiped. Settings and the suppression list were preserved. The cron job will continue on its normal schedule.",
      ...result,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        ok: false,
        error: message,
        hint: "Check Neon connection and that the user role has TRUNCATE privileges on these tables.",
      },
      { status: 500 }
    );
  }
}
