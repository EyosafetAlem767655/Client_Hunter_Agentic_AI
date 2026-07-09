import { listJobsPaginated } from "@/lib/db/queries";
import { jobSourceLabel } from "@/lib/job-sources";
import {
  exportResponse,
  parseFormat,
  type ExportColumn,
  type ExportRow,
} from "@/lib/export/tabular";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Big enough to cover the whole filtered set in one file.
const MAX_ROWS = 5_000;

const COLUMNS: ExportColumn[] = [
  { key: "company", header: "Company" },
  { key: "title", header: "Job Title" },
  { key: "description", header: "Job Description" },
  { key: "source", header: "Source" },
  { key: "score", header: "Score" },
  { key: "isRelevant", header: "Relevant" },
  { key: "roleCategory", header: "Role Category" },
  { key: "fitReason", header: "AI Reasoning" },
  { key: "location", header: "Location" },
  { key: "url", header: "URL" },
  { key: "scrapedAt", header: "Scraped At" },
  { key: "isEnriched", header: "Enriched" },
];

// Excel refuses to open a workbook holding a cell longer than this.
const MAX_CELL_CHARS = 32_000;

type Item = {
  posting: {
    id: number;
    title: string;
    company: string;
    source: string;
    location: string;
    url: string;
    description: string | null;
    scrapedAt: Date;
  };
  filtered?: { score: number; isRelevant: boolean; roleCategory: string | null; fitReason: string | null } | null;
  isEnriched?: boolean;
};

/**
 * Export the jobs matching the caller's current filters (same params the Jobs
 * page uses), as CSV or a real .xlsx workbook.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const format = parseFormat(url.searchParams.get("format"));
  const status = url.searchParams.get("status") ?? "all";
  const sortParam = url.searchParams.get("sort");
  const sort = sortParam === "relevancy" || sortParam === "recentness" ? sortParam : undefined;
  const windowParam = url.searchParams.get("window") ?? "7d";
  const timeWindow = windowParam === "all" ? undefined : windowParam;

  const { items } = await listJobsPaginated({
    status,
    sort,
    timeWindow,
    page: 1,
    pageSize: MAX_ROWS,
  });

  const rows: ExportRow[] = (items as Item[]).map((it) => ({
    company: it.posting.company,
    title: it.posting.title,
    description: (it.posting.description ?? "").slice(0, MAX_CELL_CHARS),
    source: jobSourceLabel(it.posting.source as Parameters<typeof jobSourceLabel>[0]),
    score: it.filtered?.score ?? "",
    isRelevant: it.filtered ? it.filtered.isRelevant : "",
    roleCategory: it.filtered?.roleCategory ?? "",
    fitReason: it.filtered?.fitReason ?? "",
    location: it.posting.location,
    url: it.posting.url,
    scrapedAt: it.posting.scrapedAt,
    isEnriched: it.isEnriched ?? false,
  }));

  const stamp = new Date().toISOString().slice(0, 10);
  return exportResponse(rows, COLUMNS, format, `jobs-${status}-${stamp}`);
}
