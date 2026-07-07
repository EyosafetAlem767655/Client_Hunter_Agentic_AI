import {
  and,
  count,
  desc,
  eq,
  gte,
  isNotNull,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { PROMPT_VERSION } from "@/lib/llm/prompts";

const NON_CONTACT_SOURCE_TYPES = ["skipped", "no_contact_url"];
import type { RawPosting } from "@/types";
import type { ScrapeSourceStatus } from "@/types";
import {
  HIDDEN_JOB_SOURCES,
  REQUESTED_JOB_SOURCES,
  isVisibleJobSource,
  jobSourceLabel,
  notAttemptedSourceStatus,
} from "@/lib/job-sources";
import { getDb } from "./index";
import {
  agentEvents,
  agentRuns,
  companyEnrichments,
  contacts,
  filteredJobs,
  jobPostings,
  llmCache,
  outreachEmails,
  rateLimits,
  settings,
  suppressionList,
} from "./schema";

function visiblePostingSource() {
  if (HIDDEN_JOB_SOURCES.length === 0) return sql`true`;
  if (HIDDEN_JOB_SOURCES.length === 1) return ne(jobPostings.source, HIDDEN_JOB_SOURCES[0]);
  return notInArray(jobPostings.source, [...HIDDEN_JOB_SOURCES]);
}

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
    .where(
      and(
        // Never filtered, OR filtered with an older prompt (needs re-evaluation)
        or(isNull(filteredJobs.id), ne(filteredJobs.promptVersion, PROMPT_VERSION)),
        visiblePostingSource()
      )
    )
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
  const values = {
    postingId: data.postingId,
    isRelevant: data.isRelevant,
    score: data.score,
    roleCategory: data.roleCategory,
    fitReason: data.fitReason,
    suggestedRegions: data.suggestedRegions,
    estimatedSalaryRange: data.estimatedSalaryRange,
    llmModel: data.llmModel,
    promptVersion: data.promptVersion,
  };
  const [row] = await db
    .insert(filteredJobs)
    .values(values)
    .onConflictDoUpdate({
      target: filteredJobs.postingId,
      set: { ...values, filteredAt: new Date() },
    })
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
    .where(
      and(
        eq(filteredJobs.isRelevant, true),
        isNull(contacts.id),
        visiblePostingSource()
      )
    )
    .orderBy(desc(filteredJobs.score))
    .limit(limit);
  return relevant;
}

/**
 * Snapshot of where the 1-by-1 contact discovery loop is. Used by the UI
 * progress bar and by the next-step endpoint to know when to stop.
 */
export async function getDiscoveryProgress(): Promise<{
  totalRelevant: number;
  withContacts: number;
  attempted: number;
  skipped: number;
  pending: number;
  nextCompany: string | null;
}> {
  const db = getDb();
  const [totalRow] = await db
    .select({ total: count() })
    .from(filteredJobs)
    .innerJoin(jobPostings, eq(jobPostings.id, filteredJobs.postingId))
    .where(and(eq(filteredJobs.isRelevant, true), visiblePostingSource()));

  // Every distinct posting that has *any* contact row, sentinels included.
  const attemptedRows = await db
    .selectDistinct({ postingId: contacts.postingId })
    .from(contacts)
    .innerJoin(jobPostings, eq(jobPostings.id, contacts.postingId))
    .where(visiblePostingSource());
  const attempted = attemptedRows.length;

  // Only real, useful contacts (no sentinels).
  const withContactsRows = await db
    .selectDistinct({ postingId: contacts.postingId })
    .from(contacts)
    .innerJoin(jobPostings, eq(jobPostings.id, contacts.postingId))
    .where(
      and(
        notInArray(contacts.sourceType, NON_CONTACT_SOURCE_TYPES),
        visiblePostingSource()
      )
    );
  const withContacts = withContactsRows.length;

  const totalRelevant = totalRow?.total ?? 0;
  const skipped = attempted - withContacts;
  const pending = Math.max(0, totalRelevant - attempted);

  const [nextRow] = await db
    .select({ company: jobPostings.company })
    .from(filteredJobs)
    .innerJoin(jobPostings, eq(jobPostings.id, filteredJobs.postingId))
    .leftJoin(contacts, eq(contacts.postingId, jobPostings.id))
    .where(
      and(
        eq(filteredJobs.isRelevant, true),
        isNull(contacts.id),
        visiblePostingSource()
      )
    )
    .orderBy(desc(filteredJobs.score))
    .limit(1);

  return {
    totalRelevant,
    withContacts,
    attempted,
    skipped,
    pending,
    nextCompany: nextRow?.company ?? null,
  };
}

export async function upsertContact(data: {
  postingId: number;
  email?: string | null;
  contactUrl?: string | null;
  sourceType: string;
  confidence: string;
}) {
  if (!data.email && !data.contactUrl && data.sourceType !== "no_contact_url") {
    throw new Error("upsertContact requires email or contactUrl");
  }
  const db = getDb();
  const [row] = await db
    .insert(contacts)
    .values({
      postingId: data.postingId,
      email: data.email ? data.email.toLowerCase() : null,
      contactUrl: data.contactUrl ?? null,
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
    .where(
      and(
        isNull(outreachEmails.id),
        isNotNull(contacts.email),
        notInArray(contacts.sourceType, NON_CONTACT_SOURCE_TYPES),
        visiblePostingSource()
      )
    )
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
    .where(
      and(
        eq(outreachEmails.status, "approved"),
        isNotNull(contacts.email),
        visiblePostingSource()
      )
    )
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
    .where(
      and(
        eq(outreachEmails.status, "pending"),
        isNotNull(contacts.email),
        visiblePostingSource()
      )
    )
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
  const postingWhere = since
    ? and(visiblePostingSource(), gte(jobPostings.scrapedAt, since))
    : visiblePostingSource();

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
    .innerJoin(jobPostings, eq(jobPostings.id, contacts.postingId))
    .where(
      and(
        notInArray(contacts.sourceType, NON_CONTACT_SOURCE_TYPES),
        visiblePostingSource()
      )
    );

  const [drafted] = await db
    .select({ total: count() })
    .from(outreachEmails)
    .innerJoin(contacts, eq(contacts.id, outreachEmails.contactId))
    .innerJoin(jobPostings, eq(jobPostings.id, contacts.postingId))
    .where(
      since
        ? and(visiblePostingSource(), gte(outreachEmails.createdAt, since))
        : visiblePostingSource()
    );

  const [sent] = await db
    .select({ total: count() })
    .from(outreachEmails)
    .innerJoin(contacts, eq(contacts.id, outreachEmails.contactId))
    .innerJoin(jobPostings, eq(jobPostings.id, contacts.postingId))
    .where(
      since
        ? and(
            eq(outreachEmails.status, "sent"),
            gte(outreachEmails.sentAt, since),
            visiblePostingSource()
          )
        : and(eq(outreachEmails.status, "sent"), visiblePostingSource())
    );

  const [replied] = await db
    .select({ total: count() })
    .from(outreachEmails)
    .innerJoin(contacts, eq(contacts.id, outreachEmails.contactId))
    .innerJoin(jobPostings, eq(jobPostings.id, contacts.postingId))
    .where(and(eq(outreachEmails.status, "replied"), visiblePostingSource()));

  const [enriched] = await db
    .select({ total: count() })
    .from(companyEnrichments)
    .innerJoin(jobPostings, eq(jobPostings.id, companyEnrichments.postingId))
    .where(
      and(
        eq(companyEnrichments.status, "complete"),
        visiblePostingSource()
      )
    );

  return {
    scraped: scraped?.total ?? 0,
    relevant: relevant?.total ?? 0,
    contactsFound: withContacts?.total ?? 0,
    leadsEnriched: enriched?.total ?? 0,
    drafted: drafted?.total ?? 0,
    sent: sent?.total ?? 0,
    replied: replied?.total ?? 0,
  };
}

/**
 * Reads source status directly from job_postings — works for per-site
 * manual scrapes that don't create agent_run entries.
 */
export async function getSourceScrapeCounts(): Promise<ScrapeSourceStatus[]> {
  const db = getDb();
  const rows = await db
    .select({ source: jobPostings.source, total: count() })
    .from(jobPostings)
    .where(visiblePostingSource())
    .groupBy(jobPostings.source);

  const bySource = new Map(rows.map((r) => [r.source as RawPosting["source"], r.total]));

  return REQUESTED_JOB_SOURCES.map((source) => {
    const cnt = bySource.get(source) ?? 0;
    return cnt > 0
      ? {
          source,
          label: jobSourceLabel(source),
          ok: true as const,
          status: "scraped" as ScrapeSourceStatus["status"],
          count: cnt,
        }
      : notAttemptedSourceStatus(source);
  });
}

export async function getLatestScrapeSourceStatuses(): Promise<ScrapeSourceStatus[]> {
  const db = getDb();
  const runs = await db
    .select({ stats: agentRuns.stats })
    .from(agentRuns)
    .where(and(eq(agentRuns.runType, "scrape"), eq(agentRuns.status, "completed")))
    .orderBy(desc(agentRuns.startedAt))
    .limit(20);

  return buildLatestScrapeSourceStatuses(runs);
}

export function buildLatestScrapeSourceStatuses(
  runs: Array<{ stats: Record<string, unknown> | null | undefined }>
): ScrapeSourceStatus[] {
  let bySource = new Map<RawPosting["source"], ScrapeSourceStatus>();
  for (const run of runs) {
    bySource = groupDashboardSourceStatuses(extractSourceStatuses(run.stats));
    if (bySource.size > 0) break;
  }

  const orderedSources = [...REQUESTED_JOB_SOURCES];
  for (const source of Array.from(bySource.keys())) {
    if (!orderedSources.includes(source)) orderedSources.push(source);
  }

  return orderedSources.map((source) => {
    const existing = bySource.get(source);
    return existing ?? notAttemptedSourceStatus(source);
  });
}

function groupDashboardSourceStatuses(
  sources: ScrapeSourceStatus[]
): Map<RawPosting["source"], ScrapeSourceStatus> {
  const bySource = new Map<RawPosting["source"], ScrapeSourceStatus>();
  for (const source of sources) {
    if (!isVisibleJobSource(source.source)) continue;
    const canonicalSource = dashboardSourceFor(source.source);

    const normalized: ScrapeSourceStatus = {
      ...source,
      source: canonicalSource,
      label: jobSourceLabel(canonicalSource),
    };
    const existing = bySource.get(canonicalSource);
    bySource.set(
      canonicalSource,
      existing ? mergeSourceStatuses(existing, normalized) : normalized
    );
  }
  return bySource;
}

function dashboardSourceFor(source: RawPosting["source"]): RawPosting["source"] {
  // Fold legacy RSS scraper entries into the active DOM scraper row
  return source === "weworkremotely" ? "wwr_dom" : source;
}

function mergeSourceStatuses(
  left: ScrapeSourceStatus,
  right: ScrapeSourceStatus
): ScrapeSourceStatus {
  const count = (left.count ?? 0) + (right.count ?? 0);
  if (left.ok || right.ok) {
    return {
      source: left.source,
      label: left.label,
      ok: true,
      status: "scraped",
      count,
    };
  }
  const status =
    left.status === "not_configured" || right.status === "not_configured"
      ? "not_configured"
      : "rejected";
  return {
    source: left.source,
    label: left.label,
    ok: false,
    status,
    count,
    error: [left.error, right.error].filter(Boolean).join("; ") || undefined,
  };
}

function extractSourceStatuses(
  stats: Record<string, unknown> | null | undefined
): ScrapeSourceStatus[] {
  const perception =
    stats && typeof stats === "object"
      ? (stats.perception as Record<string, unknown> | undefined)
      : undefined;
  const sources = Array.isArray(perception?.sources) ? perception.sources : [];

  return sources
    .filter((source): source is Record<string, unknown> => Boolean(source))
    .map((source) => {
      const id = String(source.source ?? "") as RawPosting["source"];
      const ok = source.ok === true;
      const status =
        source.status === "not_configured" ||
        source.status === "rejected" ||
        source.status === "scraped"
          ? source.status
          : ok
            ? "scraped"
            : "rejected";
      return {
        source: id,
        label:
          typeof source.label === "string" ? source.label : jobSourceLabel(id),
        ok,
        status,
        count: Number(source.count ?? 0),
        error: typeof source.error === "string" ? source.error : undefined,
      };
    });
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
    .innerJoin(contacts, eq(contacts.id, outreachEmails.contactId))
    .innerJoin(jobPostings, eq(jobPostings.id, contacts.postingId))
    .where(
      and(
        eq(outreachEmails.status, "sent"),
        gte(outreachEmails.sentAt, since),
        visiblePostingSource()
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
  sort?: "relevancy" | "recentness";
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
      ? and(visiblePostingSource(), gte(jobPostings.scrapedAt, since))
      : visiblePostingSource();
    const rows = await db
      .select({
        posting: jobPostings,
        isEnriched: sql<boolean>`EXISTS (
          SELECT 1 FROM company_enrichments
          WHERE company_enrichments.posting_id = ${jobPostings.id}
        )`.as("is_enriched"),
      })
      .from(jobPostings)
      .leftJoin(filteredJobs, eq(filteredJobs.postingId, jobPostings.id))
      .where(and(isNull(filteredJobs.id), where))
      .orderBy(desc(jobPostings.scrapedAt))
      .limit(params.pageSize)
      .offset(offset);
    return { items: rows, total: rows.length };
  }

  if (params.status === "with-contact") {
    // No time window — these are pipeline rows, not events.
    const where = and(
      notInArray(contacts.sourceType, NON_CONTACT_SOURCE_TYPES),
      visiblePostingSource()
    );
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
      .innerJoin(jobPostings, eq(jobPostings.id, contacts.postingId))
      .where(where);
    return { items, total: totalRow?.total ?? 0 };
  }

  // No status param → "all jobs scraped in window" view; left-join filtered.
  if (!params.status || params.status === "all") {
    const where = since
      ? and(visiblePostingSource(), gte(jobPostings.scrapedAt, since))
      : visiblePostingSource();
    const baseQ = db
      .select({
        posting: jobPostings,
        filtered: filteredJobs,
        isEnriched: sql<boolean>`EXISTS (
          SELECT 1 FROM company_enrichments
          WHERE company_enrichments.posting_id = ${jobPostings.id}
        )`.as("is_enriched"),
      })
      .from(jobPostings)
      .leftJoin(filteredJobs, eq(filteredJobs.postingId, jobPostings.id))
      .where(where);
    const items = await (params.sort === "relevancy"
      ? baseQ.orderBy(
          sql`COALESCE(${filteredJobs.score}, -1) DESC`,
          desc(jobPostings.scrapedAt)
        )
      : baseQ.orderBy(desc(jobPostings.scrapedAt))
    )
      .limit(params.pageSize)
      .offset(offset);
    const [totalRow] = await db
      .select({ total: count() })
      .from(jobPostings)
      .where(where);
    return { items, total: totalRow?.total ?? 0 };
  }

  const conditions = [visiblePostingSource()];
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
    .select({
      posting: jobPostings,
      filtered: filteredJobs,
      isEnriched: sql<boolean>`EXISTS (
        SELECT 1 FROM company_enrichments
        WHERE company_enrichments.posting_id = ${jobPostings.id}
      )`.as("is_enriched"),
    })
    .from(filteredJobs)
    .innerJoin(jobPostings, eq(jobPostings.id, filteredJobs.postingId))
    .where(where)
    .orderBy(
      sql`date_trunc('day', ${jobPostings.scrapedAt}) DESC`,
      desc(filteredJobs.score)
    )
    .limit(params.pageSize)
    .offset(offset);

  const [totalRow] = await db
    .select({ total: count() })
    .from(filteredJobs)
    .innerJoin(jobPostings, eq(jobPostings.id, filteredJobs.postingId))
    .where(where);

  return { items, total: totalRow?.total ?? 0 };
}

export async function saveJobFeedback(
  postingId: number,
  feedback: string,
  notes: string | null
) {
  const db = getDb();
  await db
    .update(filteredJobs)
    .set({ userFeedback: feedback, userNotes: notes, feedbackAt: new Date() })
    .where(eq(filteredJobs.postingId, postingId));
}

export async function getFeedbackExamples(limit = 30) {
  const db = getDb();
  return db
    .select({
      title: jobPostings.title,
      company: jobPostings.company,
      isRelevant: filteredJobs.isRelevant,
      fitReason: filteredJobs.fitReason,
      userFeedback: filteredJobs.userFeedback,
      userNotes: filteredJobs.userNotes,
    })
    .from(filteredJobs)
    .innerJoin(jobPostings, eq(jobPostings.id, filteredJobs.postingId))
    .where(isNotNull(filteredJobs.userFeedback))
    .orderBy(desc(filteredJobs.feedbackAt))
    .limit(limit);
}

export async function listAllFeedback() {
  const db = getDb();
  return db
    .select({
      postingId: filteredJobs.postingId,
      title: jobPostings.title,
      company: jobPostings.company,
      description: jobPostings.description,
      url: jobPostings.url,
      userFeedback: filteredJobs.userFeedback,
      userNotes: filteredJobs.userNotes,
      feedbackAt: filteredJobs.feedbackAt,
      isRelevant: filteredJobs.isRelevant,
      fitReason: filteredJobs.fitReason,
    })
    .from(filteredJobs)
    .innerJoin(jobPostings, eq(jobPostings.id, filteredJobs.postingId))
    .where(isNotNull(filteredJobs.userFeedback))
    .orderBy(desc(filteredJobs.feedbackAt));
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

  const filters = [visiblePostingSource()] as Array<ReturnType<typeof eq>>;
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
    .innerJoin(contacts, eq(contacts.id, outreachEmails.contactId))
    .innerJoin(jobPostings, eq(jobPostings.id, contacts.postingId))
    .where(where);

  return { items, total: totalRow?.total ?? 0 };
}

const ENRICHED_SOURCE_TYPES = ["clay_enriched", "manually_enriched"] as const;

export async function listLeadStatusJobs(params: {
  tier: "high" | "mid";
  page: number;
  pageSize: number;
}): Promise<{
  items: Array<{
    posting: typeof jobPostings.$inferSelect;
    filtered: typeof filteredJobs.$inferSelect;
    contact: typeof contacts.$inferSelect | null;
    isEnriched: boolean;
  }>;
  total: number;
}> {
  const db = getDb();
  const offset = (params.page - 1) * params.pageSize;
  const scoreMin = params.tier === "high" ? 90 : 70;
  const scoreMax = params.tier === "high" ? 100 : 89;

  const where = and(
    eq(filteredJobs.isRelevant, true),
    gte(filteredJobs.score, scoreMin),
    lte(filteredJobs.score, scoreMax),
    visiblePostingSource()
  );

  const rows = await db
    .select({
      posting: jobPostings,
      filtered: filteredJobs,
      contact: contacts,
    })
    .from(filteredJobs)
    .innerJoin(jobPostings, eq(jobPostings.id, filteredJobs.postingId))
    .leftJoin(
      contacts,
      and(
        eq(contacts.postingId, jobPostings.id),
        eq(contacts.sourceType, "clay_enriched")
      )
    )
    .where(where)
    .orderBy(desc(filteredJobs.score))
    .limit(params.pageSize * 4)
    .offset(offset);

  // Deduplicate by postingId — a job may have multiple enriched contact rows
  const seen = new Set<number>();
  const deduped = rows.filter((r) => {
    if (seen.has(r.filtered.postingId)) return false;
    seen.add(r.filtered.postingId);
    return true;
  });
  const items = deduped.slice(0, params.pageSize);

  const [totalRow] = await db
    .select({ total: count() })
    .from(filteredJobs)
    .innerJoin(jobPostings, eq(jobPostings.id, filteredJobs.postingId))
    .where(where);

  return {
    items: items.map((r) => ({
      ...r,
      isEnriched: r.filtered.manuallyEnriched || r.contact !== null,
    })),
    total: totalRow?.total ?? 0,
  };
}

export async function markManuallyEnriched(postingId: number): Promise<void> {
  const db = getDb();
  await db
    .update(filteredJobs)
    .set({ manuallyEnriched: true })
    .where(eq(filteredJobs.postingId, postingId));
}

export async function unmarkManuallyEnriched(postingId: number): Promise<void> {
  const db = getDb();
  await db
    .update(filteredJobs)
    .set({ manuallyEnriched: false })
    .where(eq(filteredJobs.postingId, postingId));
}

export async function saveClayContacts(
  postingId: number,
  items: Array<{ email: string | null; linkedinUrl: string | null }>
): Promise<number> {
  let saved = 0;
  for (const c of items) {
    if (!c.email && !c.linkedinUrl) continue;
    await upsertContact({
      postingId,
      email: c.email,
      contactUrl: c.linkedinUrl,
      sourceType: "clay_enriched",
      confidence: "0.85",
    });
    saved++;
  }
  return saved;
}

// ── Lead Status / Enrichment queries (redesigned) ─────────────────────────

export async function listEligibleLeadJobs(params: {
  page?: number;
  pageSize?: number;
}): Promise<{
  items: Array<{
    postingId: number;
    title: string;
    company: string;
    url: string;
    score: number;
    isEnriched: boolean;
  }>;
  total: number;
}> {
  const db = getDb();
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 100;
  const offset = (page - 1) * pageSize;

  const where = and(
    eq(filteredJobs.isRelevant, true),
    gte(filteredJobs.score, 60),
    visiblePostingSource()
  );

  const rows = await db
    .select({
      postingId: jobPostings.id,
      title: jobPostings.title,
      company: jobPostings.company,
      url: jobPostings.url,
      score: filteredJobs.score,
      enrichmentStatus: companyEnrichments.status,
    })
    .from(filteredJobs)
    .innerJoin(jobPostings, eq(jobPostings.id, filteredJobs.postingId))
    .leftJoin(companyEnrichments, eq(companyEnrichments.postingId, jobPostings.id))
    .where(where)
    .orderBy(desc(filteredJobs.score))
    .limit(pageSize)
    .offset(offset);

  const [totalRow] = await db
    .select({ total: count() })
    .from(filteredJobs)
    .innerJoin(jobPostings, eq(jobPostings.id, filteredJobs.postingId))
    .where(where);

  return {
    items: rows.map((r) => ({
      postingId: r.postingId,
      title: r.title,
      company: r.company,
      url: r.url,
      score: r.score,
      isEnriched: r.enrichmentStatus === "complete",
    })),
    total: totalRow?.total ?? 0,
  };
}

export async function saveCompanyEnrichment(
  postingId: number,
  data: {
    companyName: string | null;
    location: string | null;
    website: string | null;
    staffCount: number | null;
    annualRevenue: string | null;
    facilitiesCount: number | null;
    rawData?: Record<string, unknown>;
  }
): Promise<void> {
  const db = getDb();

  const practiceSize =
    data.staffCount !== null
      ? data.staffCount <= 5
        ? "solo"
        : data.staffCount <= 25
          ? "mid"
          : null
      : null;

  await db
    .insert(companyEnrichments)
    .values({
      postingId,
      status: "complete",
      companyName: data.companyName,
      location: data.location,
      website: data.website,
      staffCount: data.staffCount,
      annualRevenue: data.annualRevenue,
      facilitiesCount: data.facilitiesCount,
      practiceSize,
      rawData: data.rawData,
    })
    .onConflictDoUpdate({
      target: companyEnrichments.postingId,
      set: {
        status: "complete",
        companyName: data.companyName,
        location: data.location,
        website: data.website,
        staffCount: data.staffCount,
        annualRevenue: data.annualRevenue,
        facilitiesCount: data.facilitiesCount,
        practiceSize,
        rawData: data.rawData,
        updatedAt: new Date(),
      },
    });
}

export async function saveEnrichedContacts(
  postingId: number,
  leads: Array<{
    name: string | null;
    title: string | null;
    email: string | null;
    phone: string | null;
    linkedinUrl: string | null;
  }>
): Promise<number> {
  const db = getDb();
  let saved = 0;
  for (const lead of leads) {
    if (!lead.email && !lead.linkedinUrl) continue;
    await db
      .insert(contacts)
      .values({
        postingId,
        email: lead.email ? lead.email.toLowerCase().trim() : null,
        contactUrl: lead.linkedinUrl ?? null,
        name: lead.name,
        title: lead.title,
        phone: lead.phone,
        sourceType: "clay_enriched",
        confidence: "0.85",
      })
      .onConflictDoNothing();
    saved++;
  }
  return saved;
}

export async function getEnrichmentDetail(postingId: number): Promise<{
  enrichment: typeof companyEnrichments.$inferSelect | null;
  leads: Array<typeof contacts.$inferSelect>;
}> {
  const db = getDb();

  const [enrichment] = await db
    .select()
    .from(companyEnrichments)
    .where(eq(companyEnrichments.postingId, postingId))
    .limit(1);

  const leads = await db
    .select()
    .from(contacts)
    .where(
      and(
        eq(contacts.postingId, postingId),
        eq(contacts.sourceType, "clay_enriched")
      )
    );

  return { enrichment: enrichment ?? null, leads };
}

export async function listEnrichedJobs(params: {
  page?: number;
  pageSize?: number;
}): Promise<{
  items: Array<{
    postingId: number;
    title: string;
    company: string;
    url: string;
    score: number;
    enrichment: typeof companyEnrichments.$inferSelect;
    enrichedAt: Date;
  }>;
  total: number;
}> {
  const db = getDb();
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 100;
  const offset = (page - 1) * pageSize;

  const where = and(
    eq(companyEnrichments.status, "complete"),
    visiblePostingSource()
  );

  const rows = await db
    .select({
      postingId: jobPostings.id,
      title: jobPostings.title,
      company: jobPostings.company,
      url: jobPostings.url,
      score: filteredJobs.score,
      enrichment: companyEnrichments,
      contactCount: sql<number>`(
        SELECT COUNT(*) FROM contacts
        WHERE contacts.posting_id = ${jobPostings.id}
        AND contacts.source_type = 'clay_enriched'
      )`.as("contact_count"),
    })
    .from(companyEnrichments)
    .innerJoin(jobPostings, eq(jobPostings.id, companyEnrichments.postingId))
    .innerJoin(filteredJobs, eq(filteredJobs.postingId, jobPostings.id))
    .where(where)
    .orderBy(desc(companyEnrichments.updatedAt))
    .limit(pageSize)
    .offset(offset);

  const [totalRow] = await db
    .select({ total: count() })
    .from(companyEnrichments)
    .innerJoin(jobPostings, eq(jobPostings.id, companyEnrichments.postingId))
    .where(where);

  return {
    items: rows.map((r) => ({
      ...r,
      enrichedAt: r.enrichment.updatedAt,
      contactCount: r.contactCount ?? 0,
    })),
    total: totalRow?.total ?? 0,
  };
}

// ── Close CRM helpers ────────────────────────────────────────────────────────

export async function saveCloseLeadId(
  postingId: number,
  closeLeadId: string,
  closeLeadStatus: string
): Promise<void> {
  await getDb()
    .update(companyEnrichments)
    .set({ closeLeadId, closeLeadStatus, updatedAt: new Date() })
    .where(eq(companyEnrichments.postingId, postingId));
}

export async function clearCloseLeadId(postingId: number): Promise<void> {
  await getDb()
    .update(companyEnrichments)
    .set({ closeLeadId: null, closeLeadStatus: null, updatedAt: new Date() })
    .where(eq(companyEnrichments.postingId, postingId));
}

export async function listEnrichmentsLinkedToCrm(): Promise<
  Array<{ postingId: number; closeLeadId: string }>
> {
  const rows = await getDb()
    .select({
      postingId: companyEnrichments.postingId,
      closeLeadId: companyEnrichments.closeLeadId,
    })
    .from(companyEnrichments)
    .where(isNotNull(companyEnrichments.closeLeadId));
  return rows as Array<{ postingId: number; closeLeadId: string }>;
}

export async function updateCloseLeadStatus(
  postingId: number,
  closeLeadStatus: string
): Promise<void> {
  await getDb()
    .update(companyEnrichments)
    .set({ closeLeadStatus, updatedAt: new Date() })
    .where(eq(companyEnrichments.postingId, postingId));
}

// ── Feedback / training helpers ───────────────────────────────────────────────

export async function countNewFeedbackSince(since: Date): Promise<number> {
  const [row] = await getDb()
    .select({ total: count() })
    .from(filteredJobs)
    .where(
      and(
        isNotNull(filteredJobs.userFeedback),
        gte(filteredJobs.feedbackAt, since)
      )
    );
  return row?.total ?? 0;
}
