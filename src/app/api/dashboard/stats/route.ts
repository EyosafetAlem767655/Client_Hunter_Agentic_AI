import { NextResponse } from "next/server";
import { getDashboardStats } from "@/lib/db/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const window = url.searchParams.get("window") ?? "24h";
  const allowed = ["24h", "7d", "30d"];
  const timeWindow = allowed.includes(window) ? window : "24h";

  try {
    const stats = await getDashboardStats(timeWindow);
    return NextResponse.json({ ok: true, stats, timeWindow });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Query failed" },
      { status: 500 }
    );
  }
}
