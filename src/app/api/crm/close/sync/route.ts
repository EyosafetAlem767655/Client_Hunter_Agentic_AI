import { NextResponse } from "next/server";
import { closeGet, isCloseConfigured } from "@/lib/close/client";
import { listEnrichmentsLinkedToCrm, updateCloseLeadStatus } from "@/lib/db/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  if (!isCloseConfigured()) {
    return NextResponse.json({ error: "CLOSE_API_KEY not configured" }, { status: 400 });
  }

  try {
    const linked = await listEnrichmentsLinkedToCrm();
    let synced = 0;
    let errors = 0;

    for (const row of linked) {
      try {
        const lead = await closeGet<{ id: string; status_label: string }>(
          `/lead/${row.closeLeadId}/?_fields=id,status_label`
        );
        await updateCloseLeadStatus(row.postingId, lead.status_label);
        synced++;
      } catch {
        errors++;
      }
    }

    return NextResponse.json({ synced, errors, total: linked.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Sync failed" },
      { status: 500 }
    );
  }
}
