CREATE TABLE "agent_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"context" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_type" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"stats" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"posting_id" integer NOT NULL,
	"email" text,
	"contact_url" text,
	"source_type" text NOT NULL,
	"confidence" numeric(3, 2) NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"discovered_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "filtered_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"posting_id" integer NOT NULL,
	"is_relevant" boolean NOT NULL,
	"score" integer NOT NULL,
	"role_category" text,
	"fit_reason" text,
	"suggested_regions" jsonb,
	"estimated_salary_range" text,
	"filtered_at" timestamp DEFAULT now() NOT NULL,
	"llm_model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"user_feedback" text,
	"user_notes" text,
	"feedback_at" timestamp,
	CONSTRAINT "filtered_jobs_posting_id_unique" UNIQUE("posting_id")
);
--> statement-breakpoint
CREATE TABLE "job_postings" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"company" text NOT NULL,
	"location" text NOT NULL,
	"description" text NOT NULL,
	"posted_at" timestamp,
	"raw" jsonb NOT NULL,
	"scraped_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_emails" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_id" integer NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp,
	"message_id" text,
	"error_message" text,
	"dry_run" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_start" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppression_list" (
	"email" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_posting_id_job_postings_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."job_postings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filtered_jobs" ADD CONSTRAINT "filtered_jobs_posting_id_job_postings_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."job_postings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_emails" ADD CONSTRAINT "outreach_emails_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_events_created_at_idx" ON "agent_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_posting_email_idx" ON "contacts" USING btree ("posting_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_posting_contact_url_idx" ON "contacts" USING btree ("posting_id","contact_url");--> statement-breakpoint
CREATE INDEX "filtered_jobs_score_idx" ON "filtered_jobs" USING btree ("score");--> statement-breakpoint
CREATE UNIQUE INDEX "job_postings_source_external_id_idx" ON "job_postings" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "job_postings_scraped_at_idx" ON "job_postings" USING btree ("scraped_at");--> statement-breakpoint
CREATE INDEX "outreach_emails_sent_at_idx" ON "outreach_emails" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "outreach_emails_status_idx" ON "outreach_emails" USING btree ("status");--> statement-breakpoint
CREATE INDEX "outreach_emails_created_at_idx" ON "outreach_emails" USING btree ("created_at");