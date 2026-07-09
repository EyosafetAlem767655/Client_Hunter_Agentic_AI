import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/auth";
import { isCloseConfigured } from "@/lib/close/client";
import { pushPostingToClose, type PushResult } from "@/lib/close/push";
import { sleep } from "@/lib/utils";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Cap per request so we stay inside the 60 s function budget and don't hammer
// Close's rate limit. The UI loops if more leads are selected.
const MAX_PER_CALL = 40;

/**
 * Bulk-create Close leads from selected postings. Runs sequentially (Close is
 * rate-limited) and returns a per-posting result so partial failures are visible.
 */
export async function POST(req: NextRequest) {
  if (!verifyAdminAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isCloseConfigured()) {
    return NextResponse.json({ error: "CLOSE_API_KEY not configured" }, { status: 400 });
  }

  let postingIds: number[];
  try {
    const body = (await req.json()) as { postingIds?: unknown };
    if (!Array.isArray(body.postingIds)) throw new Error("invalid");
    postingIds = body.postingIds
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (postingIds.length === 0) throw new Error("empty");
  } catch {
    return NextResponse.json(
      { error: "postingIds: number[] is required" },
      { status: 400 }
    );
  }

  const batch = postingIds.slice(0, MAX_PER_CALL);
  const results: PushResult[] = [];
  for (const id of batch) {
    results.push(await pushPostingToClose(id));
    await sleep(150); // gentle pacing for Close's rate limit
  }

  const created = results.filter((r) => r.ok && r.action === "created").length;
  const updated = results.filter((r) => r.ok && r.action === "updated").length;
  const failed = results.filter((r) => !r.ok);

  return NextResponse.json({
    ok: failed.length === 0,
    processed: results.length,
    created,
    updated,
    failed: failed.length,
    remaining: Math.max(0, postingIds.length - batch.length),
    results,
  });
}
