import { NextResponse } from "next/server";
import { healthCheck } from "@/lib/db";
import { getLastSuccessfulRunAt } from "@/lib/db/queries";
import { resolveDatabaseUrl } from "@/lib/database-url";

export const dynamic = "force-dynamic";

export async function GET() {
  let envError: string | null = null;
  try {
    await import("@/lib/env");
  } catch (e) {
    envError = e instanceof Error ? e.message : "Env validation failed";
  }

  const dbConnected = envError ? false : await healthCheck();
  let lastRunAt: string | null = null;

  if (dbConnected) {
    try {
      const run = await getLastSuccessfulRunAt();
      lastRunAt = run?.toISOString() ?? null;
    } catch {
      // tables may still be initializing
    }
  }

  return NextResponse.json({
    ok: !envError && dbConnected,
    dbConnected,
    lastRunAt,
    envError,
    hasDatabaseUrl: Boolean(resolveDatabaseUrl()),
  });
}
