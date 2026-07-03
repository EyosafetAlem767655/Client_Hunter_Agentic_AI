import { NextRequest, NextResponse } from "next/server";
import { closePost, isCloseConfigured } from "@/lib/close/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!isCloseConfigured()) {
    return NextResponse.json({ error: "CLOSE_API_KEY not configured" }, { status: 400 });
  }
  try {
    const body = await req.json() as unknown;
    const data = await closePost("/contact/", body);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
