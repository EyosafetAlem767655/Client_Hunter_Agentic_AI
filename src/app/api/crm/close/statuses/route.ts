import { NextResponse } from "next/server";
import { closeGet, isCloseConfigured } from "@/lib/close/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!isCloseConfigured()) {
    return NextResponse.json({ error: "CLOSE_API_KEY not configured" }, { status: 400 });
  }
  try {
    const data = await closeGet("/status/lead/");
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
