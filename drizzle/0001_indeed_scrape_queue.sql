CREATE TABLE IF NOT EXISTS "indeed_scrape_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"query" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"worker_id" text,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"claimed_at" timestamp,
	"completed_at" timestamp,
	"fetched" integer DEFAULT 0 NOT NULL,
	"inserted" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "indeed_scrape_jobs_status_requested_idx" ON "indeed_scrape_jobs" USING btree ("status", "requested_at");
