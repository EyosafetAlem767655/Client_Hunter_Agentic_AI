import { NextResponse } from "next/server";
import { closeDelete, isCloseConfigured } from "@/lib/close/client";
import { getEnrichmentDetail, clearCloseLeadId } from "@/lib/db/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: { postingId: string } }
) {
  if (!isCloseConfigured()) {
    return NextResponse.json({ error: "CLOSE_API_KEY not configured" }, { status: 400 });
  }

  const postingId = Number(params.postingId);
  if (!Number.isInteger(postingId) || postingId <= 0) {
    return NextResponse.json({ error: "Invalid postingId" }, { status: 400 });
  }

  try {
    const { enrichment } = await getEnrichmentDetail(postingId);

    if (!enrichment?.closeLeadId) {
      return NextResponse.json({ ok: true, note: "was not linked" });
    }

    // Delete from Close first — if it fails, DB link is preserved so user can retry
    await closeDelete(`/lead/${enrichment.closeLeadId}/`);
    await clearCloseLeadId(postingId);

    return NextResponse.json({ ok: true, deletedLeadId: enrichment.closeLeadId });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unlink failed" },
      { status: 500 }
    );
  }
}
