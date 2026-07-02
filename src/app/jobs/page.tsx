import Link from "next/link";
import { JobsTable, type JobRow } from "@/components/jobs/jobs-table";
import { FeedbackTab, type FeedbackEntry } from "@/components/jobs/feedback-tab";
import { DbErrorBanner } from "@/components/dashboard/db-error-banner";
import { listJobsPaginated, listAllFeedback, getSetting } from "@/lib/db/queries";
import { jobSourceLabel } from "@/lib/job-sources";
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
  { key: "feedback", label: "Feedback", status: "feedback" },
];

const WINDOWS: Array<{ value: string; label: string }> = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "All time" },
];

const PAGE_SIZE = 50;

export const dynamic = "force-dynamic";

export default async function JobsPage({
  searchParams,
}: {
  searchParams?: { status?: string; window?: string; page?: string };
}) {
  const activeStatus = searchParams?.status ?? "all";
  const activeWindow = searchParams?.window ?? "7d";
  const currentPage = Math.max(1, Number(searchParams?.page ?? 1));
  const timeWindow = activeWindow === "all" ? undefined : activeWindow;

  let jobs: JobRow[] = [];
  let feedbackEntries: FeedbackEntry[] = [];
  let lastTrainedAt: string | null = null;
  let error: string | null = null;
  let total = 0;

  if (activeStatus === "feedback") {
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
        } catch {
          // ignore
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load feedback";
    }
  } else {
    try {
      const { items, total: rowTotal } = await listJobsPaginated({
        status: activeStatus === "all" ? undefined : activeStatus,
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
        contactEmail: row.contact?.email ?? null,
        contactUrl: row.contact?.contactUrl ?? null,
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
          <p className="mt-1 text-sm text-muted-foreground">
            {total} {total === 1 ? "row" : "rows"} ·{" "}
            {activeWindow === "all" ? "all time" : `last ${activeWindow}`}
          </p>
        </div>
        <div className="inline-flex rounded-xl border border-amber-900/15 bg-white/50 p-1 backdrop-blur">
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
                  ? "bg-gradient-to-r from-amber-700 to-orange-600 text-white shadow"
                  : "text-foreground/70 hover:text-foreground"
              }`}
            >
              {w.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-amber-900/15 pb-2">
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
                ? "bg-amber-200/60 text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {error && <DbErrorBanner message={error} />}
      {!error && activeStatus === "feedback" && (
        <FeedbackTab entries={feedbackEntries} lastTrainedAt={lastTrainedAt} />
      )}
      {!error && activeStatus !== "feedback" && <JobsTable jobs={jobs} />}

      {/* Pagination */}
      {activeStatus !== "feedback" && totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 pt-2">
          {currentPage > 1 && (
            <Link
              href={{
                pathname: "/jobs",
                query: {
                  ...(activeStatus !== "all" ? { status: activeStatus } : {}),
                  window: activeWindow,
                  page: currentPage - 1,
                },
              }}
              className="rounded-lg border border-border/40 px-3 py-1.5 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground transition"
            >
              ← Prev
            </Link>
          )}

          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter(
              (p) =>
                p === 1 ||
                p === totalPages ||
                Math.abs(p - currentPage) <= 2
            )
            .reduce<(number | "...")[]>((acc, p, idx, arr) => {
              if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push("...");
              acc.push(p);
              return acc;
            }, [])
            .map((p, i) =>
              p === "..." ? (
                <span key={`ellipsis-${i}`} className="px-2 text-muted-foreground text-sm">
                  …
                </span>
              ) : (
                <Link
                  key={p}
                  href={{
                    pathname: "/jobs",
                    query: {
                      ...(activeStatus !== "all" ? { status: activeStatus } : {}),
                      window: activeWindow,
                      page: p,
                    },
                  }}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                    p === currentPage
                      ? "border-amber-700/60 bg-amber-100/60 font-medium text-foreground"
                      : "border-border/40 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  {p}
                </Link>
              )
            )}

          {currentPage < totalPages && (
            <Link
              href={{
                pathname: "/jobs",
                query: {
                  ...(activeStatus !== "all" ? { status: activeStatus } : {}),
                  window: activeWindow,
                  page: currentPage + 1,
                },
              }}
              className="rounded-lg border border-border/40 px-3 py-1.5 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground transition"
            >
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
