import { NextRequest, NextResponse } from "next/server";
import { closeGet, closePost, isCloseConfigured } from "@/lib/close/client";
import { toClosePayload, type ImportLead } from "@/lib/close/csv-import";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Keep each request inside the serverless time budget; the client chunks. */
const MAX_LEADS_PER_CALL = 25;

interface ImportResult {
  company: string;
  ok: boolean;
  action?: "created" | "merged";
  leadId?: string;
  contactsAdded?: number;
  error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Close treats lead names as free text, so match on an exact-name search. */
async function findLeadByName(name: string): Promise<string | null> {
  const qs = new URLSearchParams({
    query: `name:"${name.replace(/"/g, '\\"')}"`,
    _limit: "1",
    _fields: "id,name",
  });
  const res = await closeGet<{ data: Array<{ id: string; name: string }> }>(`/lead/?${qs}`);
  const hit = res.data?.[0];
  return hit && hit.name.toLowerCase() === name.toLowerCase() ? hit.id : null;
}

async function importOne(lead: ImportLead, statusId?: string): Promise<ImportResult> {
  try {
    const payload = toClosePayload(lead, statusId);
    const existingId = await findLeadByName(lead.company);

    if (!existingId) {
      const created = await closePost<{ id: string }>("/lead/", payload);
      return {
        company: lead.company,
        ok: true,
        action: "created",
        leadId: created.id,
        contactsAdded: lead.contacts.length,
      };
    }

    // Lead already exists — attach the new contacts rather than duplicating it.
    const contacts = payload.contacts as Array<Record<string, unknown>>;
    for (const contact of contacts) {
      await closePost("/contact/", { ...contact, lead_id: existingId });
    }
    return {
      company: lead.company,
      ok: true,
      action: "merged",
      leadId: existingId,
      contactsAdded: contacts.length,
    };
  } catch (e) {
    return {
      company: lead.company,
      ok: false,
      error: e instanceof Error ? e.message : "Import failed",
    };
  }
}

/** Create the reviewed leads in Close, one at a time so a bad row can't sink the batch. */
export async function POST(req: NextRequest) {
  if (!isCloseConfigured()) {
    return NextResponse.json({ error: "CLOSE_API_KEY not configured" }, { status: 400 });
  }

  let body: { leads?: ImportLead[]; statusId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const all = Array.isArray(body.leads) ? body.leads : [];
  if (all.length === 0) {
    return NextResponse.json({ error: "No leads to import" }, { status: 400 });
  }

  const batch = all.slice(0, MAX_LEADS_PER_CALL);
  const results: ImportResult[] = [];
  for (const lead of batch) {
    results.push(await importOne(lead, body.statusId));
    await sleep(150); // stay under Close's rate limit
  }

  return NextResponse.json({
    ok: true,
    processed: results.length,
    created: results.filter((r) => r.action === "created").length,
    merged: results.filter((r) => r.action === "merged").length,
    failed: results.filter((r) => !r.ok).length,
    remaining: all.length - batch.length,
    results,
  });
}
