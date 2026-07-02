import { NextResponse } from "next/server";
import { listLeadStatusJobs } from "@/lib/db/queries";
import type { contacts, filteredJobs, jobPostings } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface LeadJob {
  postingId: number;
  title: string;
  company: string;
  url: string;
  score: number;
  isEnriched: boolean;
  contactEmail: string | null;
  contactUrl: string | null;
}

type ListItem = {
  posting: typeof jobPostings.$inferSelect;
  filtered: typeof filteredJobs.$inferSelect;
  contact: typeof contacts.$inferSelect | null;
  isEnriched: boolean;
};

const MANUAL_SENTINEL = "__manually_enriched__";

function toLeadJob(r: ListItem): LeadJob {
  const isManualMark = r.contact?.sourceType === "manually_enriched";
  return {
    postingId: r.posting.id,
    title: r.posting.title,
    company: r.posting.company,
    url: r.posting.url,
    score: r.filtered.score,
    isEnriched: r.isEnriched,
    // Don't surface the sentinel email or manual-mark rows as real contact details
    contactEmail: (!isManualMark && r.contact?.email && r.contact.email !== MANUAL_SENTINEL)
      ? r.contact.email
      : null,
    contactUrl: (!isManualMark && r.contact?.contactUrl) ? r.contact.contactUrl : null,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const pageSize = Math.min(200, Math.max(1, Number(searchParams.get("pageSize") ?? "100")));

  try {
    const [high, mid] = await Promise.all([
      listLeadStatusJobs({ tier: "high", page, pageSize }),
      listLeadStatusJobs({ tier: "mid", page, pageSize }),
    ]);

    return NextResponse.json({
      high: { items: high.items.map(toLeadJob), total: high.total },
      mid: { items: mid.items.map(toLeadJob), total: mid.total },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Query failed" },
      { status: 500 }
    );
  }
}
