import { and, asc, eq, lt, or } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { indeedScrapeJobs } from "@/lib/db/schema";

export type IndeedQueueStatus = "queued" | "running" | "completed" | "failed";

export async function enqueueIndeedScrape(query?: string) {
  const [job] = await getDb()
    .insert(indeedScrapeJobs)
    .values({ query: query?.trim() || null, status: "queued" })
    .returning();
  return job;
}

export async function getIndeedScrapeJob(id: number) {
  const [job] = await getDb()
    .select()
    .from(indeedScrapeJobs)
    .where(eq(indeedScrapeJobs.id, id))
    .limit(1);
  return job ?? null;
}

export async function claimNextIndeedScrape(workerId: string) {
  const staleBefore = new Date(Date.now() - 10 * 60_000);
  const [candidate] = await getDb()
    .select()
    .from(indeedScrapeJobs)
    .where(
      or(
        eq(indeedScrapeJobs.status, "queued"),
        and(
          eq(indeedScrapeJobs.status, "running"),
          lt(indeedScrapeJobs.claimedAt, staleBefore)
        )
      )
    )
    .orderBy(asc(indeedScrapeJobs.requestedAt))
    .limit(1);

  if (!candidate) return null;
  const [claimed] = await getDb()
    .update(indeedScrapeJobs)
    .set({
      status: "running",
      workerId,
      claimedAt: new Date(),
      completedAt: null,
      error: null,
    })
    .where(
      and(
        eq(indeedScrapeJobs.id, candidate.id),
        candidate.status === "queued"
          ? eq(indeedScrapeJobs.status, "queued")
          : and(
              eq(indeedScrapeJobs.status, "running"),
              lt(indeedScrapeJobs.claimedAt, staleBefore)
            )
      )
    )
    .returning();
  return claimed ?? null;
}

export async function finishIndeedScrape(
  id: number,
  result: { fetched: number; inserted: number }
) {
  const [job] = await getDb()
    .update(indeedScrapeJobs)
    .set({
      status: "completed",
      completedAt: new Date(),
      fetched: result.fetched,
      inserted: result.inserted,
      error: null,
    })
    .where(eq(indeedScrapeJobs.id, id))
    .returning();
  return job ?? null;
}

export async function failIndeedScrape(id: number, error: string) {
  const [job] = await getDb()
    .update(indeedScrapeJobs)
    .set({
      status: "failed",
      completedAt: new Date(),
      error: error.slice(0, 1000),
    })
    .where(eq(indeedScrapeJobs.id, id))
    .returning();
  return job ?? null;
}
