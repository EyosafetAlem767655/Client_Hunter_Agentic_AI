import { NextResponse } from "next/server";
import {
  getDashboardStats,
  getEmailsSentPerDay,
  listRecentEvents,
} from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const window = searchParams.get("window") ?? "7d";
  const valid = ["24h", "7d", "30d", "all"];
  const timeWindow = valid.includes(window) ? window : "7d";

  const stats = await getDashboardStats(timeWindow);
  const trend = await getEmailsSentPerDay(30);
  const activity = await listRecentEvents(20, 0);

  return NextResponse.json({ stats, trend, activity, window: timeWindow });
}
