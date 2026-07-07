import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import {
  getEnrichmentDetail,
  saveCompanyEnrichment,
  saveEnrichedContacts,
} from "@/lib/db/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Lead = {
  name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Accept Clay's varied field names for a single contact row. */
function parseLead(o: Record<string, unknown>): Lead {
  return {
    name: str(o.name) ?? str(o.full_name) ?? str(o.fullName),
    title: str(o.title) ?? str(o.job_title) ?? str(o.jobTitle),
    email: str(o.email)?.toLowerCase() ?? null,
    phone: str(o.phone) ?? str(o.phone_number),
    linkedinUrl: str(o.linkedin_url) ?? str(o.linkedinUrl) ?? str(o.linkedin),
  };
}

/**
 * Callback receiver for Clay. Clay posts enriched rows back here after it
 * finishes enriching a company we sent via /api/admin/enrich. Public endpoint —
 * guarded only by the shared x-clay-webhook-auth secret (or ?token=).
 */
export async function POST(request: Request) {
  const token = env.CLAY_AUTH_TOKEN;
  const url = new URL(request.url);
  const provided =
    request.headers.get("x-clay-webhook-auth") ?? url.searchParams.get("token") ?? "";
  if (!token || provided !== token) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const postingId = num(body.posting_id ?? body.postingId);
  if (!postingId) {
    return NextResponse.json(
      { ok: false, error: "posting_id is required to route the callback" },
      { status: 400 }
    );
  }

  // Leads may arrive as an array under `leads`, or as a single flat contact row.
  const rawLeads = Array.isArray(body.leads)
    ? (body.leads as unknown[])
    : [body];
  const leads = rawLeads
    .filter((l): l is Record<string, unknown> => !!l && typeof l === "object")
    .map(parseLead)
    .filter((l) => l.email || l.linkedinUrl);

  const saved = await saveEnrichedContacts(postingId, leads);

  // Flip the enrichment to complete, preserving the domain/reasoning captured at
  // trigger time and merging any company fields Clay returned.
  const { enrichment } = await getEnrichmentDetail(postingId);
  const company = (body.company as Record<string, unknown> | undefined) ?? body;
  const prevRaw = (enrichment?.rawData as Record<string, unknown> | undefined) ?? {};

  await saveCompanyEnrichment(postingId, {
    companyName: str(company.company_name) ?? enrichment?.companyName ?? null,
    location: str(company.location) ?? enrichment?.location ?? null,
    website: str(company.domain) ?? str(company.website) ?? enrichment?.website ?? null,
    staffCount: num(company.employee_count ?? company.staff_count) ?? enrichment?.staffCount ?? null,
    annualRevenue: str(company.annual_revenue) ?? enrichment?.annualRevenue ?? null,
    facilitiesCount: num(company.num_locations) ?? enrichment?.facilitiesCount ?? null,
    status: "complete",
    rawData: { ...prevRaw, leadsReturned: leads.length, calledBackAt: new Date().toISOString() },
  });

  return NextResponse.json({ ok: true, postingId, saved });
}
