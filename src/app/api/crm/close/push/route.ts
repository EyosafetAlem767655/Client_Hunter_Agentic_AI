import { NextRequest, NextResponse } from "next/server";
import { closePost, isCloseConfigured } from "@/lib/close/client";
import { getEnrichmentDetail } from "@/lib/db/queries";

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

    const contacts = leads.map((l) => ({
      name: l.name ?? "Unknown",
      title: l.title ?? undefined,
      emails: l.email ? [{ email: l.email, type: "office" }] : [],
      phones: l.phone ? [{ phone: l.phone, type: "office" }] : [],
      urls: l.contactUrl ? [{ url: l.contactUrl, type: "linkedin" }] : [],
    }));

    const lead = await closePost<{ id: string }>("/lead/", {
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
      contacts,
    });

    return NextResponse.json({ ok: true, leadId: lead.id, contactsCreated: contacts.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Push failed" },
      { status: 500 }
    );
  }
}
