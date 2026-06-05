import { NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/auth";
import { getDiscoveryProgress } from "@/lib/db/queries";

export const maxDuration = 10;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Snapshot used by the progress bar. Cheap DB-only call.
 */
export async function GET(request: Request) {
  if (!verifyAdminAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const progress = await getDiscoveryProgress();
    return NextResponse.json({ ok: true, ...progress });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 200 }
    );
  }
}
