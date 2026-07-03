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
    const q = sp.get("query");
    if (q) qs.set("query", q);
    qs.set("_limit", sp.get("_limit") ?? "25");
    qs.set("_skip", sp.get("_skip") ?? "0");
    qs.set("_fields", "id,name,status_id,status_label,url,description,contacts,date_updated");
    const data = await closeGet(`/lead/?${qs}`);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isCloseConfigured()) return notConfigured();
  try {
    const body = await req.json() as unknown;
    const data = await closePost("/lead/", body);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
