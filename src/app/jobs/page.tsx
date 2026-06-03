import { JobsTable, type JobRow } from "@/components/jobs/jobs-table";
import { listJobsPaginated } from "@/lib/db/queries";
import type { filteredJobs, jobPostings } from "@/lib/db/schema";

type JobListItem = {
  posting: typeof jobPostings.$inferSelect;
  filtered: typeof filteredJobs.$inferSelect;
};

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const { items } = await listJobsPaginated({
    page: 1,
    pageSize: 50,
  });

  const jobs: JobRow[] = (items as JobListItem[]).map((row) => ({
    id: row.posting.id,
    title: row.posting.title,
    company: row.posting.company,
    score: row.filtered?.score ?? null,
    isRelevant: row.filtered?.isRelevant ?? null,
    fitReason: row.filtered?.fitReason ?? null,
    description: row.posting.description,
    url: row.posting.url,
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Job postings</h1>
      <JobsTable jobs={jobs} />
    </div>
  );
}
