import { NextRequest, NextResponse } from "next/server";
import { closePost, closePut, isCloseConfigured } from "@/lib/close/client";
import { getEnrichmentDetail, saveCloseLeadId } from "@/lib/db/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!isCloseConfigured()) {
    return NextResponse.json({ error: "CLOSE_API_KEY not configured" }, { status: 400 });
  }

  let postingId: number;
  try {
    const body = await req.json() as { postingId?: unknown };
    postingId = Number(body.postingId);
    if (!Number.isInteger(postingId) || postingId <= 0) throw new Error("invalid");
  } catch {
    return NextResponse.json({ error: "postingId is required" }, { status: 400 });
  }

  try {
    const { enrichment, leads } = await getEnrichmentDetail(postingId);

    const contactPayload = leads.map((l) => ({
      name: l.name ?? "Unknown",
      title: l.title ?? undefined,
      emails: l.email ? [{ email: l.email, type: "office" }] : [],
      phones: l.phone ? [{ phone: l.phone, type: "office" }] : [],
      urls: l.contactUrl ? [{ url: l.contactUrl, type: "linkedin" }] : [],
    }));

    const leadMeta = {
      name: enrichment?.companyName ?? `Job posting #${postingId}`,
      url: enrichment?.website ?? undefined,
      description: [
        enrichment?.location ? `Location: ${enrichment.location}` : null,
        enrichment?.staffCount != null ? `Staff: ${enrichment.staffCount}` : null,
        enrichment?.practiceSize ? `Practice size: ${enrichment.practiceSize}` : null,
        "Pushed from TalentBridge Enrichment tab.",
      ]
        .filter(Boolean)
        .join(" · "),
    };

    let lead: { id: string; status_label?: string };
    let action: "created" | "updated";

    if (enrichment?.closeLeadId) {
      // Lead already in Close — update metadata only, don't re-add contacts
      lead = await closePut<{ id: string; status_label?: string }>(
        `/lead/${enrichment.closeLeadId}/`,
        leadMeta
      );
      action = "updated";
    } else {
      // First push — create with embedded contacts
      lead = await closePost<{ id: string; status_label?: string }>("/lead/", {
        ...leadMeta,
        contacts: contactPayload,
      });
      action = "created";
    }

    // Always persist the lead ID and status back to DB
    await saveCloseLeadId(postingId, lead.id, lead.status_label ?? "Active");

    return NextResponse.json({
      ok: true,
      action,
      leadId: lead.id,
      contactsCreated: action === "created" ? contactPayload.length : 0,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Push failed" },
      { status: 500 }
    );
  }
}
