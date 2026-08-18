import { NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/auth";
import { discoverNextContacts } from "@/lib/agent/action";
import { getDiscoveryProgress } from "@/lib/db/queries";

// Each call processes at most ~5 companies; one cycle finishes well inside
// the Vercel Hobby ceiling so the UI loop never 504s.
export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Process the next N pending jobs through the discovery chain. The
 * Settings UI calls this in a loop (with a small "rest" between calls)
 * to drive the progress bar forward without ever exceeding the 60 s
 * function budget.
 *
 * Query: ?n=1..5 (default 1).
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
  const url = new URL(request.url);
  const n = Math.max(1, Math.min(5, Number(url.searchParams.get("n") ?? 1)));

  const started = Date.now();
  try {
    const step = await discoverNextContacts(n);
    const progress = await getDiscoveryProgress();
    return NextResponse.json({
      ok: true,
      step,
      progress,
      done: progress.pending === 0,
      durationMs: Date.now() - started,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        hint: "Check LangSearch / Gemini / Neon connectivity and that the contact discovery chain isn't blocked.",
      },
      { status: 200 }
    );
  }
}
