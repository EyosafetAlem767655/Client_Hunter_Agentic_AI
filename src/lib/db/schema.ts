import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const jobPostings = pgTable(
  "job_postings",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    company: text("company").notNull(),
    location: text("location").notNull(),
    description: text("description").notNull(),
    postedAt: timestamp("posted_at"),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull(),
    scrapedAt: timestamp("scraped_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("job_postings_source_external_id_idx").on(
      table.source,
      table.externalId
    ),
    index("job_postings_scraped_at_idx").on(table.scrapedAt),
  ]
);

export const filteredJobs = pgTable(
  "filtered_jobs",
  {
    id: serial("id").primaryKey(),
    postingId: integer("posting_id")
      .references(() => jobPostings.id)
      .notNull()
      .unique(),
    isRelevant: boolean("is_relevant").notNull(),
    score: integer("score").notNull(),
    roleCategory: text("role_category"),
    fitReason: text("fit_reason"),
    suggestedRegions: jsonb("suggested_regions").$type<string[]>(),
    estimatedSalaryRange: text("estimated_salary_range"),
    filteredAt: timestamp("filtered_at").defaultNow().notNull(),
    llmModel: text("llm_model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    userFeedback: text("user_feedback"),
    userNotes: text("user_notes"),
    feedbackAt: timestamp("feedback_at"),
    manuallyEnriched: boolean("manually_enriched").default(false).notNull(),
  },
  (table) => [index("filtered_jobs_score_idx").on(table.score)]
);

export const contacts = pgTable(
  "contacts",
  {
    id: serial("id").primaryKey(),
    postingId: integer("posting_id")
      .references(() => jobPostings.id)
      .notNull(),
    email: text("email"),
    contactUrl: text("contact_url"),
    name: text("name"),
    title: text("title"),
    phone: text("phone"),
    sourceType: text("source_type").notNull(),
    confidence: numeric("confidence", { precision: 3, scale: 2 }).notNull(),
    verified: boolean("verified").default(false).notNull(),
    discoveredAt: timestamp("discovered_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("contacts_posting_email_idx").on(table.postingId, table.email),
    uniqueIndex("contacts_posting_contact_url_idx").on(
      table.postingId,
      table.contactUrl
    ),
  ]
);

export const outreachEmails = pgTable(
  "outreach_emails",
  {
    id: serial("id").primaryKey(),
    contactId: integer("contact_id")
      .references(() => contacts.id)
      .notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    status: text("status").notNull().default("pending"),
    sentAt: timestamp("sent_at"),
    messageId: text("message_id"),
    errorMessage: text("error_message"),
    dryRun: boolean("dry_run").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("outreach_emails_sent_at_idx").on(table.sentAt),
    index("outreach_emails_status_idx").on(table.status),
    index("outreach_emails_created_at_idx").on(table.createdAt),
  ]
);

export const agentRuns = pgTable("agent_runs", {
  id: serial("id").primaryKey(),
  runType: text("run_type").notNull(),
  status: text("status").notNull(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
  stats: jsonb("stats").$type<Record<string, unknown>>(),
  error: text("error"),
});

export const agentEvents = pgTable(
  "agent_events",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id").references(() => agentRuns.id),
    level: text("level").notNull(),
    message: text("message").notNull(),
    context: jsonb("context").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("agent_events_created_at_idx").on(table.createdAt)]
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: timestamp("window_start").notNull(),
});

export const suppressionList = pgTable("suppression_list", {
  email: text("email").primaryKey(),
  reason: text("reason").notNull(),
  addedAt: timestamp("added_at").defaultNow().notNull(),
});

export const llmCache = pgTable("llm_cache", {
  key: text("key").primaryKey(),
  model: text("model").notNull(),
  response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const indeedScrapeJobs = pgTable(
  "indeed_scrape_jobs",
  {
    id: serial("id").primaryKey(),
    query: text("query"),
    status: text("status").notNull().default("queued"),
    workerId: text("worker_id"),
    requestedAt: timestamp("requested_at").defaultNow().notNull(),
    claimedAt: timestamp("claimed_at"),
    completedAt: timestamp("completed_at"),
    fetched: integer("fetched").default(0).notNull(),
    inserted: integer("inserted").default(0).notNull(),
    error: text("error"),
  },
  (table) => [
    index("indeed_scrape_jobs_status_requested_idx").on(
      table.status,
      table.requestedAt
    ),
  ]
);

export const companyEnrichments = pgTable(
  "company_enrichments",
  {
    id: serial("id").primaryKey(),
    postingId: integer("posting_id")
      .references(() => jobPostings.id)
      .notNull(),
    status: text("status").notNull().default("complete"),
    companyName: text("company_name"),
    location: text("location"),
    website: text("website"),
    facilitiesCount: integer("facilities_count"),
    staffCount: integer("staff_count"),
    annualRevenue: text("annual_revenue"),
    practiceSize: text("practice_size"),
    rawData: jsonb("raw_data").$type<Record<string, unknown>>(),
    closeLeadId: text("close_lead_id"),
    closeLeadStatus: text("close_lead_status"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("ce_posting_id_idx").on(t.postingId)]
);
