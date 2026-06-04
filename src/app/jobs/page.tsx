import { JobsTable, type JobRow } from "@/components/jobs/jobs-table";
import { DbErrorBanner } from "@/components/dashboard/db-error-banner";
import { listJobsPaginated } from "@/lib/db/queries";
import type { filteredJobs, jobPostings } from "@/lib/db/schema";

type JobListItem = {
  posting: typeof jobPostings.$inferSelect;
  filtered: typeof filteredJobs.$inferSelect;
};

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  let jobs: JobRow[] = [];
  let error: string | null = null;

  try {
    const { items } = await listJobsPaginated({
      page: 1,
      pageSize: 50,
    });
    jobs = (items as JobListItem[]).map((row) => ({
      id: row.posting.id,
      title: row.posting.title,
      company: row.posting.company,
      score: row.filtered?.score ?? null,
      isRelevant: row.filtered?.isRelevant ?? null,
      fitReason: row.filtered?.fitReason ?? null,
      description: row.posting.description,
      url: row.posting.url,
    }));
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load jobs";
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Job postings</h1>
      {error && <DbErrorBanner message={error} />}
      {!error && <JobsTable jobs={jobs} />}
    </div>
  );
}
