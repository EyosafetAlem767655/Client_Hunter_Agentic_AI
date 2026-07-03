import { NextRequest, NextResponse } from "next/server";
import { closeGet, closePost, isCloseConfigured } from "@/lib/close/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function notConfigured() {
  return NextResponse.json({ error: "CLOSE_API_KEY not configured" }, { status: 400 });
}

export async function GET(req: NextRequest) {
  if (!isCloseConfigured()) return notConfigured();
  try {
    const sp = new URL(req.url).searchParams;
    const qs = new URLSearchParams();
    const leadId = sp.get("lead_id");
    if (leadId) qs.set("lead_id", leadId);
    const view = sp.get("view") ?? "inbox";
    qs.set("view", view);
    qs.set("_limit", "50");
    const data = await closeGet(`/task/?${qs}`);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isCloseConfigured()) return notConfigured();
  try {
    const body = await req.json() as unknown;
    const data = await closePost("/task/", body);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
