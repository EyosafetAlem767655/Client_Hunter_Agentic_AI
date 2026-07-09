import { closePost, closePut } from "@/lib/close/client";
import { getEnrichmentDetail, saveCloseLeadId } from "@/lib/db/queries";

export interface PushResult {
  postingId: number;
  ok: boolean;
  action?: "created" | "updated";
  leadId?: string;
  contactsCreated?: number;
  error?: string;
}

/**
 * Create (or update) one Close lead from a posting's enrichment + contacts.
 * Shared by the single-lead push and the bulk push.
 */
export async function pushPostingToClose(postingId: number): Promise<PushResult> {
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
      // Already in Close — update metadata only, don't re-add contacts.
      lead = await closePut<{ id: string; status_label?: string }>(
        `/lead/${enrichment.closeLeadId}/`,
        leadMeta
      );
      action = "updated";
    } else {
      lead = await closePost<{ id: string; status_label?: string }>("/lead/", {
        ...leadMeta,
        contacts: contactPayload,
      });
      action = "created";
    }

    await saveCloseLeadId(postingId, lead.id, lead.status_label ?? "Active");

    return {
      postingId,
      ok: true,
      action,
      leadId: lead.id,
      contactsCreated: action === "created" ? contactPayload.length : 0,
    };
  } catch (e) {
    return {
      postingId,
      ok: false,
      error: e instanceof Error ? e.message : "Push failed",
    };
  }
}
