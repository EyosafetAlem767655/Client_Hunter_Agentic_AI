import { NextRequest, NextResponse } from "next/server";
import { isCloseConfigured } from "@/lib/close/client";
import { pushPostingToClose } from "@/lib/close/push";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!isCloseConfigured()) {
    return NextResponse.json({ error: "CLOSE_API_KEY not configured" }, { status: 400 });
  }

  let postingId: number;
  try {
    const body = await req.json() as { postingId?: unknown };
    postingId = Number(body.postingId);
    if (!Number.isInteger(postingId) || postingId <= 0) throw new Error("invalid");
  } catch {
    return NextResponse.json({ error: "postingId is required" }, { status: 400 });
  }

  const result = await pushPostingToClose(postingId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "Push failed" }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    action: result.action,
    leadId: result.leadId,
    contactsCreated: result.contactsCreated ?? 0,
  });
}
