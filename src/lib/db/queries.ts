import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  notInArray,
  sql,
} from "drizzle-orm";
import type { RawPosting } from "@/types";
import { getDb } from "./index";
import {
  agentEvents,
  agentRuns,
  contacts,
  filteredJobs,
  jobPostings,
  llmCache,
  outreachEmails,
  rateLimits,
  settings,
  suppressionList,
} from "./schema";

export async function upsertJobPosting(posting: RawPosting) {
  const db = getDb();
  const [row] = await db
    .insert(jobPostings)
    .values({
      source: posting.source,
      externalId: posting.externalId,
      url: posting.url,
      title: posting.title,
      company: posting.company,
      location: posting.location,
      description: posting.description,
      postedAt: posting.postedAt,
      raw: posting.raw,
    })
    .onConflictDoUpdate({
      target: [jobPostings.source, jobPostings.externalId],
      set: {
        title: posting.title,
        description: posting.description,
        scrapedAt: new Date(),
        raw: posting.raw,
      },
    })
    .returning();
  return row;
}

export async function getExistingExternalIds(
  source: string,
  externalIds: string[]
): Promise<Set<string>> {
  if (externalIds.length === 0) return new Set();
  const db = getDb();
  const rows = await db
    .select({ externalId: jobPostings.externalId })
    .from(jobPostings)
    .where(
      and(
        eq(jobPostings.source, source),
        inArray(jobPostings.externalId, externalIds)
      )
    );
  return new Set(rows.map((r) => r.externalId));
}

export async function listUnfilteredPostings(limit: number) {
  const db = getDb();
  return db
    .select({ posting: jobPostings })
    .from(jobPostings)
    .leftJoin(filteredJobs, eq(filteredJobs.postingId, jobPostings.id))
    .where(isNull(filteredJobs.id))
    .limit(limit);
}

export async function insertFilteredJob(data: {
  postingId: number;
  isRelevant: boolean;
  score: number;
  roleCategory: string | null;
  fitReason: string | null;
  suggestedRegions: string[];
  estimatedSalaryRange: string | null;
  llmModel: string;
  promptVersion: string;
}) {
  const db = getDb();
  const [row] = await db
    .insert(filteredJobs)
    .values({
      postingId: data.postingId,
      isRelevant: data.isRelevant,
      score: data.score,
      roleCategory: data.roleCategory,
      fitReason: data.fitReason,
      suggestedRegions: data.suggestedRegions,
      estimatedSalaryRange: data.estimatedSalaryRange,
      llmModel: data.llmModel,
      promptVersion: data.promptVersion,
    })
    .onConflictDoNothing()
    .returning();
  return row;
}

export async function listTopRelevantWithoutContacts(limit: number) {
  const db = getDb();
  const relevant = await db
    .select({ posting: jobPostings, filtered: filteredJobs })
    .from(filteredJobs)
    .innerJoin(jobPostings, eq(jobPostings.id, filteredJobs.postingId))
    .leftJoin(contacts, eq(contacts.postingId, jobPostings.id))
    .where(and(eq(filteredJobs.isRelevant, true), isNull(contacts.id)))
    .orderBy(desc(filteredJobs.score))
    .limit(limit);
  return relevant;
}

export async function upsertContact(data: {
  postingId: number;
  email: string;
  sourceType: string;
  confidence: string;
}) {
  const db = getDb();
  const [row] = await db
    .insert(contacts)
    .values({
      postingId: data.postingId,
      email: data.email.toLowerCase(),
      sourceType: data.sourceType,
      confidence: data.confidence,
    })
    .onConflictDoNothing()
    .returning();
  return row;
}

export async function listJobsNeedingDraft(limit: number) {
  const db = getDb();
  return db
    .select({ contact: contacts, posting: jobPostings, filtered: filteredJobs })
    .from(contacts)
    .innerJoin(jobPostings, eq(jobPostings.id, contacts.postingId))
    .innerJoin(filteredJobs, eq(filteredJobs.postingId, jobPostings.id))
    .leftJoin(outreachEmails, eq(outreachEmails.contactId, contacts.id))
    .where(isNull(outreachEmails.id))
    .limit(limit);
}

export async function createOutreachEmail(data: {
  contactId: number;
  subject: string;
  body: string;
  dryRun: boolean;
  status?: string;
}) {
  const db = getDb();
  const [row] = await db
    .insert(outreachEmails)
    .values({
      contactId: data.contactId,
      subject: data.subject,
      body: data.body,
      dryRun: data.dryRun,
      status: data.status ?? "pending",
    })
    .returning();
  return row;
}

export async function listApprovedOutreach(limit: number) {
  const db = getDb();
  return db
    .select({
      email: outreachEmails,
      contact: contacts,
      posting: jobPostings,
    })
    .from(outreachEmails)
    .innerJoin(contacts, eq(contacts.id, outreachEmails.contactId))
    .innerJoin(jobPostings, eq(jobPostings.id, contacts.postingId))
    .where(eq(outreachEmails.status, "approved"))
    .limit(limit);
}

export async function listPendingOutreach(limit: number) {
  const db = getDb();
  return db
    .select({
      email: outreachEmails,
      contact: contacts,
      posting: jobPostings,
    })
    .from(outreachEmails)
    .innerJoin(contacts, eq(contacts.id, outreachEmails.contactId))
    .innerJoin(jobPostings, eq(jobPostings.id, contacts.postingId))
    .where(eq(outreachEmails.status, "pending"))
    .limit(limit);
}

export async function updateOutreachStatus(
  id: number,
  status: string,
  extra?: { sentAt?: Date; messageId?: string; errorMessage?: string }
) {
  const db = getDb();
  await db
    .update(outreachEmails)
    .set({ status, ...extra })
    .where(eq(outreachEmails.id, id));
}

export async function getOutreachById(id: number) {
  const db = getDb();
  const [row] = await db
    .select({
      email: outreachEmails,
      contact: contacts,
      posting: jobPostings,
    })
    .from(outreachEmails)
    .innerJoin(contacts, eq(contacts.id, outreachEmails.contactId))
    .innerJoin(jobPostings, eq(jobPostings.id, contacts.postingId))
    .where(eq(outreachEmails.id, id))
    .limit(1);
  return row;
}

export async function isSuppressed(email: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(suppressionList)
    .where(eq(suppressionList.email, email.toLowerCase()))
    .limit(1);
  return !!row;
}

export async function getRateLimit(key: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(rateLimits)
    .where(eq(rateLimits.key, key))
    .limit(1);
  return row;
}

export async function incrementRateLimit(key: string, windowStart: Date) {
  const db = getDb();
  const existing = await getRateLimit(key);
  if (!existing) {
    await db.insert(rateLimits).values({ key, count: 1, windowStart });
    return 1;
  }
  if (existing.windowStart < windowStart) {
    await db
      .update(rateLimits)
      .set({ count: 1, windowStart })
      .where(eq(rateLimits.key, key));
    return 1;
  }
  const newCount = existing.count + 1;
  await db
    .update(rateLimits)
    .set({ count: newCount })
    .where(eq(rateLimits.key, key));
  return newCount;
}

export async function countEmailsSentToday(): Promise<number> {
  const db = getDb();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const [row] = await db
    .select({ total: count() })
    .from(outreachEmails)
    .where(
      and(
        eq(outreachEmails.status, "sent"),
        gte(outreachEmails.sentAt, start),
        eq(outreachEmails.dryRun, false)
      )
    );
  return row?.total ?? 0;
}

export async function countDomainSendsInWindow(
  domain: string,
  since: Date
): Promise<number> {
  const db = getDb();
  const key = `domain:${domain}`;
  const row = await getRateLimit(key);
  if (!row || row.windowStart < since) return 0;
  return row.count;
}

export async function recordDomainSend(domain: string) {
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - 30);
  await incrementRateLimit(`domain:${domain}`, windowStart);
}

export async function getLlmCache(key: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(llmCache)
    .where(eq(llmCache.key, key))
    .limit(1);
  return row;
}

export async function setLlmCache(
  key: string,
  model: string,
  response: Record<string, unknown>
) {
  const db = getDb();
  await db
    .insert(llmCache)
    .values({ key, model, response })
    .onConflictDoUpdate({
      target: llmCache.key,
      set: { model, response, createdAt: new Date() },
    });
}

export async function createAgentRun(runType: string) {
  const db = getDb();
  const [row] = await db
    .insert(agentRuns)
    .values({ runType, status: "running" })
    .returning();
  return row;
}

export async function finishAgentRun(
  id: number,
  status: string,
  stats?: Record<string, unknown>,
  error?: string
) {
  const db = getDb();
  await db
    .update(agentRuns)
    .set({
      status,
      finishedAt: new Date(),
      stats,
      error,
    })
    .where(eq(agentRuns.id, id));
}

export async function insertAgentEvent(data: {
  runId?: number;
  level: string;
  message: string;
  context?: Record<string, unknown>;
}) {
  const db = getDb();
  await db.insert(agentEvents).values({
    runId: data.runId,
    level: data.level,
    message: data.message,
    context: data.context,
  });
}

export async function getLastSuccessfulRunAt(): Promise<Date | null> {
  const db = getDb();
  const [row] = await db
    .select({ finishedAt: agentRuns.finishedAt })
    .from(agentRuns)
    .where(eq(agentRuns.status, "completed"))
    .orderBy(desc(agentRuns.finishedAt))
    .limit(1);
  return row?.finishedAt ?? null;
}

export async function getSetting(key: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  const db = getDb();
  await db
    .insert(settings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: new Date() },
    });
}

function windowStart(window: string): Date | null {
  const now = new Date();
  switch (window) {
    case "24h":
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    default:
      return null;
  }
}

export async function getDashboardStats(timeWindow = "7d") {
  const db = getDb();
  const since = windowStart(timeWindow);
  const postingWhere = since ? gte(jobPostings.scrapedAt, since) : undefined;

  const [scraped] = await db
    .select({ total: count() })
    .from(jobPostings)
    .where(postingWhere);

  const [relevant] = await db
    .select({ total: count() })
    .from(filteredJobs)
    .where(
      since
        ? and(eq(filteredJobs.isRelevant, true), gte(filteredJobs.filteredAt, since))
        : eq(filteredJobs.isRelevant, true)
    );

  const [withContacts] = await db
    .select({ total: count() })
    .from(contacts)
    .where(since ? gte(contacts.discoveredAt, since) : undefined);

  const [drafted] = await db
    .select({ total: count() })
    .from(outreachEmails)
    .where(since ? gte(outreachEmails.createdAt, since) : undefined);

  const [sent] = await db
    .select({ total: count() })
    .from(outreachEmails)
    .where(
      since
        ? and(eq(outreachEmails.status, "sent"), gte(outreachEmails.sentAt, since))
        : eq(outreachEmails.status, "sent")
    );

  const [replied] = await db
    .select({ total: count() })
    .from(outreachEmails)
    .where(eq(outreachEmails.status, "replied"));

  return {
    scraped: scraped?.total ?? 0,
    relevant: relevant?.total ?? 0,
    contactsFound: withContacts?.total ?? 0,
    drafted: drafted?.total ?? 0,
    sent: sent?.total ?? 0,
    replied: replied?.total ?? 0,
  };
}

export async function getEmailsSentPerDay(days = 30) {
  const db = getDb();
  const since = new Date();
  since.setDate(since.getDate() - days);
  const rows = await db
    .select({
      day: sql<string>`date_trunc('day', ${outreachEmails.sentAt})::date`,
      total: count(),
    })
    .from(outreachEmails)
    .where(
      and(
        eq(outreachEmails.status, "sent"),
        gte(outreachEmails.sentAt, since)
      )
    )
    .groupBy(sql`date_trunc('day', ${outreachEmails.sentAt})::date`);
  return rows;
}

export async function listRecentEvents(limit: number, offset: number) {
  const db = getDb();
  return db
    .select()
    .from(agentEvents)
    .orderBy(desc(agentEvents.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function listJobsPaginated(params: {
  status?: string;
  minScore?: number;
  page: number;
  pageSize: number;
  timeWindow?: string;
}) {
  const db = getDb();
  const offset = (params.page - 1) * params.pageSize;
  const since = params.timeWindow ? windowStart(params.timeWindow) : null;

  if (params.status === "unfiltered") {
    const where = since
      ? gte(jobPostings.scrapedAt, since)
      : undefined;
    const rows = await db
      .select({ posting: jobPostings })
      .from(jobPostings)
      .leftJoin(filteredJobs, eq(filteredJobs.postingId, jobPostings.id))
      .where(where ? and(isNull(filteredJobs.id), where) : isNull(filteredJobs.id))
      .orderBy(desc(jobPostings.scrapedAt))
      .limit(params.pageSize)
      .offset(offset);
    return { items: rows, total: rows.length };
  }

  if (params.status === "with-contact") {
    const where = since ? gte(contacts.discoveredAt, since) : undefined;
    const items = await db
      .select({
        posting: jobPostings,
        filtered: filteredJobs,
        contact: contacts,
      })
      .from(contacts)
      .innerJoin(jobPostings, eq(jobPostings.id, contacts.postingId))
      .leftJoin(filteredJobs, eq(filteredJobs.postingId, jobPostings.id))
      .where(where)
      .orderBy(desc(contacts.discoveredAt))
      .limit(params.pageSize)
      .offset(offset);
    const [totalRow] = await db
      .select({ total: count() })
      .from(contacts)
      .where(where);
    return { items, total: totalRow?.total ?? 0 };
  }

  // No status param → "all jobs scraped in window" view; left-join filtered.
  if (!params.status || params.status === "all") {
    const where = since ? gte(jobPostings.scrapedAt, since) : undefined;
    const items = await db
      .select({ posting: jobPostings, filtered: filteredJobs })
      .from(jobPostings)
      .leftJoin(filteredJobs, eq(filteredJobs.postingId, jobPostings.id))
      .where(where)
      .orderBy(desc(jobPostings.scrapedAt))
      .limit(params.pageSize)
      .offset(offset);
    const [totalRow] = await db
      .select({ total: count() })
      .from(jobPostings)
      .where(where);
    return { items, total: totalRow?.total ?? 0 };
  }

  const conditions = [];
  if (params.minScore !== undefined) {
    conditions.push(gte(filteredJobs.score, params.minScore));
  }
  if (params.status === "relevant") {
    conditions.push(eq(filteredJobs.isRelevant, true));
  } else if (params.status === "irrelevant") {
    conditions.push(eq(filteredJobs.isRelevant, false));
  }
  if (since) {
    conditions.push(gte(filteredJobs.filteredAt, since));
  }

  const where = conditions.length ? and(...conditions) : undefined;
  const items = await db
    .select({ posting: jobPostings, filtered: filteredJobs })
    .from(filteredJobs)
    .innerJoin(jobPostings, eq(jobPostings.id, filteredJobs.postingId))
    .where(where)
    .orderBy(desc(filteredJobs.score))
    .limit(params.pageSize)
    .offset(offset);

  const [totalRow] = await db
    .select({ total: count() })
    .from(filteredJobs)
    .where(where);

  return { items, total: totalRow?.total ?? 0 };
}

/**
 * Wipe all ingested pipeline data so the user can start fresh. Keeps:
 * - settings (preserves DRY_RUN, AGENT_ENABLED, admin-set values)
 * - suppression_list (unsubscribes / bounces should never be lost)
 *
 * Cron schedules live in vercel.json, not the DB — they are unaffected.
 */
export async function resetPipelineData(): Promise<{
  tables: string[];
  counts: Record<string, number>;
}> {
  const db = getDb();
  // CASCADE handles FKs (filtered_jobs → job_postings, contacts → job_postings,
  // outreach_emails → contacts, agent_events → agent_runs). RESTART IDENTITY
  // resets serial PKs so the next run starts at id 1.
  await db.execute(sql`TRUNCATE TABLE
    outreach_emails,
    contacts,
    filtered_jobs,
    job_postings,
    agent_events,
    agent_runs,
    rate_limits,
    llm_cache
    RESTART IDENTITY CASCADE`);

  const counts: Record<string, number> = {};
  for (const t of [
    "job_postings",
    "filtered_jobs",
    "contacts",
    "outreach_emails",
    "agent_runs",
    "agent_events",
    "rate_limits",
    "llm_cache",
  ] as const) {
    const res = (await db.execute(
      sql.raw(`SELECT COUNT(*)::int AS total FROM ${t}`)
    )) as unknown;
    let total = 0;
    if (Array.isArray(res)) {
      total = (res as Array<{ total: number }>)[0]?.total ?? 0;
    } else if (res && typeof res === "object" && "rows" in res) {
      const rows = (res as { rows: Array<{ total: number }> }).rows;
      total = rows?.[0]?.total ?? 0;
    }
    counts[t] = total;
  }

  return {
    tables: Object.keys(counts),
    counts,
  };
}

export async function listOutreachPaginated(params: {
  status?: string;
  page: number;
  pageSize: number;
  timeWindow?: string;
}) {
  const db = getDb();
  const offset = (params.page - 1) * params.pageSize;
  const since = params.timeWindow ? windowStart(params.timeWindow) : null;

  const filters = [] as Array<ReturnType<typeof eq>>;
  if (params.status) {
    filters.push(eq(outreachEmails.status, params.status));
  }
  if (since) {
    // For sent rows, filter by sentAt; otherwise by createdAt.
    if (params.status === "sent") {
      filters.push(gte(outreachEmails.sentAt, since));
    } else {
      filters.push(gte(outreachEmails.createdAt, since));
    }
  }
  const where = filters.length ? and(...filters) : undefined;

  const items = await db
    .select({
      email: outreachEmails,
      contact: contacts,
      posting: jobPostings,
    })
    .from(outreachEmails)
    .innerJoin(contacts, eq(contacts.id, outreachEmails.contactId))
    .innerJoin(jobPostings, eq(jobPostings.id, contacts.postingId))
    .where(where)
    .orderBy(desc(outreachEmails.createdAt))
    .limit(params.pageSize)
    .offset(offset);

  const [totalRow] = await db
    .select({ total: count() })
    .from(outreachEmails)
    .where(where);

  return { items, total: totalRow?.total ?? 0 };
}
