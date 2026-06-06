import Link from "next/link";
import { JobsTable, type JobRow } from "@/components/jobs/jobs-table";
import { DbErrorBanner } from "@/components/dashboard/db-error-banner";
import { listJobsPaginated } from "@/lib/db/queries";
import type { contacts, filteredJobs, jobPostings } from "@/lib/db/schema";

type JobListItem = {
  posting: typeof jobPostings.$inferSelect;
  filtered: typeof filteredJobs.$inferSelect | null;
  contact?: typeof contacts.$inferSelect;
};

const TABS: Array<{ key: string; label: string; status?: string }> = [
  { key: "all", label: "All scraped" },
  { key: "relevant", label: "Relevant", status: "relevant" },
  { key: "unfiltered", label: "Unfiltered", status: "unfiltered" },
  { key: "with-contact", label: "With contact", status: "with-contact" },
];

const WINDOWS: Array<{ value: string; label: string }> = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "All time" },
];

export const dynamic = "force-dynamic";

export default async function JobsPage({
  searchParams,
}: {
  searchParams?: { status?: string; window?: string };
}) {
  const activeStatus = searchParams?.status ?? "all";
  const activeWindow = searchParams?.window ?? "24h";
  const timeWindow = activeWindow === "all" ? undefined : activeWindow;

  let jobs: JobRow[] = [];
  let error: string | null = null;
  let total = 0;

  try {
    const { items, total: rowTotal } = await listJobsPaginated({
      status: activeStatus === "all" ? undefined : activeStatus,
      timeWindow,
      page: 1,
      pageSize: 100,
    });
    total = rowTotal;
    jobs = (items as JobListItem[]).map((row) => ({
      id: row.posting.id,
      title: row.posting.title,
      company: row.posting.company,
      score: row.filtered?.score ?? null,
      isRelevant: row.filtered?.isRelevant ?? null,
      fitReason: row.filtered?.fitReason ?? null,
      description: row.posting.description,
      url: row.posting.url,
      scrapedAt: row.posting.scrapedAt
        ? new Date(row.posting.scrapedAt).toISOString()
        : null,
      contactEmail: row.contact?.email ?? null,
    }));
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load jobs";
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Job postings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total} {total === 1 ? "row" : "rows"} ·{" "}
            {activeWindow === "all" ? "all time" : `last ${activeWindow}`}
          </p>
        </div>
        <div className="inline-flex rounded-xl border border-white/10 bg-white/5 p-1 backdrop-blur">
          {WINDOWS.map((w) => (
            <Link
              key={w.value}
              href={{
                pathname: "/jobs",
                query: {
                  ...(activeStatus !== "all" ? { status: activeStatus } : {}),
                  window: w.value,
                },
              }}
              className={`rounded-lg px-3 py-1.5 text-sm transition ${
                activeWindow === w.value
                  ? "bg-gradient-to-r from-emerald-500 to-cyan-500 text-white shadow"
                  : "text-foreground/70 hover:text-foreground"
              }`}
            >
              {w.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-white/5 pb-2">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={{
              pathname: "/jobs",
              query: {
                ...(tab.status ? { status: tab.status } : {}),
                window: activeWindow,
              },
            }}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${
              activeStatus === tab.key
                ? "bg-white/10 text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {error && <DbErrorBanner message={error} />}
      {!error && <JobsTable jobs={jobs} />}
    </div>
  );
}
