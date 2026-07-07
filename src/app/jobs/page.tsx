import Link from "next/link";
import { JobsView, type JobRow } from "@/components/jobs/jobs-view";
import { FeedbackTab, type FeedbackEntry } from "@/components/jobs/feedback-tab";
import { CloseCrmTab } from "@/components/jobs/close-crm-tab";
import { DbErrorBanner } from "@/components/dashboard/db-error-banner";
import { listJobsPaginated, listAllFeedback, getSetting } from "@/lib/db/queries";
import { jobSourceLabel } from "@/lib/job-sources";
import type { filteredJobs, jobPostings } from "@/lib/db/schema";

type JobListItem = {
  posting: typeof jobPostings.$inferSelect;
  filtered?: typeof filteredJobs.$inferSelect | null;
  isEnriched?: boolean;
};

const TABS: Array<{ key: string; label: string; statuses: string[] }> = [
  { key: "jobs",     label: "Jobs",      statuses: ["all", "relevant", "unfiltered", "lead-status", "enrichment"] },
  { key: "crm",      label: "Close CRM", statuses: ["crm"] },
  { key: "feedback", label: "Feedback",  statuses: ["feedback"] },
];

const WINDOWS: Array<{ value: string; label: string }> = [
  { value: "24h", label: "24h" },
  { value: "7d",  label: "7d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "All time" },
];

const PAGE_SIZE = 50;

export const dynamic = "force-dynamic";

export default async function JobsPage({
  searchParams,
}: {
  searchParams?: { status?: string; sort?: string; window?: string; page?: string };
}) {
  const activeStatus = searchParams?.status ?? "all";
  const activeSort = (searchParams?.sort ?? "all") as "all" | "relevancy" | "recentness";
  const activeWindow = searchParams?.window ?? "7d";
  const currentPage = Math.max(1, Number(searchParams?.page ?? 1));
  const timeWindow = activeWindow === "all" ? undefined : activeWindow;

  const activeTabKey =
    TABS.find((t) => t.statuses.includes(activeStatus))?.key ?? "jobs";
  const isJobsTab = activeTabKey === "jobs";

  let jobs: JobRow[] = [];
  let feedbackEntries: FeedbackEntry[] = [];
  let lastTrainedAt: string | null = null;
  let error: string | null = null;
  let total = 0;

  if (activeTabKey === "crm" || activeTabKey === "feedback") {
    // Client-side components fetch their own data
  }

  if (activeTabKey === "feedback") {
    try {
      const [rawEntries, learnedRulesStr] = await Promise.all([
        listAllFeedback(),
        getSetting("prompt_learnings"),
      ]);
      feedbackEntries = rawEntries.map((r) => ({
        postingId: r.postingId,
        title: r.title,
        company: r.company,
        description: r.description,
        url: r.url,
        userFeedback: r.userFeedback,
        userNotes: r.userNotes,
        feedbackAt: r.feedbackAt,
        isRelevant: r.isRelevant,
        fitReason: r.fitReason,
      }));
      if (learnedRulesStr) {
        try {
          const parsed = JSON.parse(learnedRulesStr) as { trainedAt?: string };
          lastTrainedAt = parsed.trainedAt ?? null;
        } catch { /* ignore */ }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load feedback";
    }
  }

  if (isJobsTab) {
    try {
      const { items, total: rowTotal } = await listJobsPaginated({
        sort: activeSort === "all" ? undefined : activeSort,
        timeWindow,
        page: currentPage,
        pageSize: PAGE_SIZE,
      });
      total = rowTotal;
      jobs = (items as JobListItem[]).map((row) => ({
        id: row.posting.id,
        title: row.posting.title,
        company: row.posting.company,
        source: row.posting.source,
        sourceLabel: jobSourceLabel(row.posting.source),
        score: row.filtered?.score ?? null,
        isRelevant: row.filtered?.isRelevant ?? null,
        fitReason: row.filtered?.fitReason ?? null,
        description: row.posting.description,
        url: row.posting.url,
        scrapedAt: row.posting.scrapedAt
          ? new Date(row.posting.scrapedAt).toISOString()
          : null,
        isEnriched: (row.isEnriched as boolean) ?? false,
        userFeedback: row.filtered?.userFeedback ?? null,
        userNotes: row.filtered?.userNotes ?? null,
      }));
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load jobs";
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Job postings</h1>
          {isJobsTab && (
            <p className="mt-1 text-sm text-muted-foreground">
              {total} {total === 1 ? "row" : "rows"} ·{" "}
              {activeWindow === "all" ? "all time" : `last ${activeWindow}`}
            </p>
          )}
        </div>
        {isJobsTab && (
          <div className="inline-flex rounded-xl border border-amber-900/15 bg-white/50 p-1 backdrop-blur">
            {WINDOWS.map((w) => (
              <Link
                key={w.value}
                href={{
                  pathname: "/jobs",
                  query: {
                    ...(activeSort !== "all" ? { sort: activeSort } : {}),
                    window: w.value,
                  },
                }}
                className={`rounded-lg px-3 py-1.5 text-sm transition ${
                  activeWindow === w.value
                    ? "bg-gradient-to-r from-amber-700 to-orange-600 text-white shadow"
                    : "text-foreground/70 hover:text-foreground"
                }`}
              >
                {w.label}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Main tabs */}
      <div className="flex flex-wrap gap-2 border-b border-amber-900/15 pb-2">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={{
              pathname: "/jobs",
              query: {
                ...(tab.key !== "jobs" ? { status: tab.statuses[0] } : {}),
                window: activeWindow,
              },
            }}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${
              activeTabKey === tab.key
                ? "bg-amber-200/60 text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {error && <DbErrorBanner message={error} />}

      {!error && activeTabKey === "jobs" && (
        <JobsView
          key={`${activeSort}-${activeWindow}-${currentPage}`}
          jobs={jobs}
          total={total}
          currentPage={currentPage}
          totalPages={totalPages}
          activeSort={activeSort}
          activeWindow={activeWindow}
        />
      )}
      {!error && activeTabKey === "crm" && <CloseCrmTab />}
      {!error && activeTabKey === "feedback" && (
        <FeedbackTab entries={feedbackEntries} lastTrainedAt={lastTrainedAt} />
      )}
    </div>
  );
}
