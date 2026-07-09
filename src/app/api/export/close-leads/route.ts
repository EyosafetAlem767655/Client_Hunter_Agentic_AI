import { verifyAdminAuth } from "@/lib/auth";
import { listLeadsForExport } from "@/lib/db/queries";
import {
  exportResponse,
  parseFormat,
  type ExportColumn,
  type ExportRow,
} from "@/lib/export/tabular";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Close auto-maps these standard headers. Anything prefixed `custom.` lands in a
// custom field of the same name. Multiple rows sharing a Company are grouped
// into one lead with several contacts.
const COLUMNS: ExportColumn[] = [
  { key: "companyName", header: "Company" },
  { key: "website", header: "Website" },
  { key: "leadStatus", header: "Lead Status" },
  { key: "contactName", header: "Contact Name" },
  { key: "contactTitle", header: "Contact Title" },
  { key: "contactEmail", header: "Contact Email" },
  { key: "contactPhone", header: "Contact Phone" },
  { key: "contactUrl", header: "Contact URL" },
  { key: "jobTitle", header: "custom.Job Title" },
  { key: "jobUrl", header: "custom.Job URL" },
  { key: "score", header: "custom.Relevancy Score" },
  { key: "location", header: "custom.Location" },
  { key: "staffCount", header: "custom.Staff Count" },
  { key: "annualRevenue", header: "custom.Annual Revenue" },
  { key: "practiceSize", header: "custom.Practice Size" },
  { key: "postingId", header: "custom.Posting ID" },
];

export async function GET(request: Request) {
  if (!verifyAdminAuth(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const format = parseFormat(url.searchParams.get("format"));
  const idsParam = url.searchParams.get("ids");
  const postingIds = idsParam
    ? idsParam
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0)
    : undefined;

  const leads = await listLeadsForExport(postingIds);
  const rows: ExportRow[] = leads.map((l) => ({
    ...l,
    // Close needs a status; default new leads to "Potential".
    leadStatus: l.closeLeadStatus ?? "Potential",
    website: l.website ? `https://${l.website.replace(/^https?:\/\//, "")}` : "",
  }));

  const stamp = new Date().toISOString().slice(0, 10);
  return exportResponse(rows, COLUMNS, format, `close-leads-${stamp}`);
}
