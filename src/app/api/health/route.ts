import { NextResponse } from "next/server";
import { healthCheck } from "@/lib/db";
import { getLastSuccessfulRunAt } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const dbConnected = await healthCheck();
  const lastRunAt = await getLastSuccessfulRunAt();
  return NextResponse.json({
    ok: true,
    dbConnected,
    lastRunAt: lastRunAt?.toISOString() ?? null,
  });
}
