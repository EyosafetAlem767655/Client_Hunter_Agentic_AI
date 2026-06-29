/**
 * Wipes all pipeline data from the database directly.
 * Run with: node scripts/wipe-db.mjs
 *
 * Requires DATABASE_URL or POSTGRES_URL in environment.
 * Load from .env.local with: node --env-file=.env.local scripts/wipe-db.mjs
 * Or pull from Vercel first: vercel env pull .env.local && node --env-file=.env.local scripts/wipe-db.mjs
 */

import { neon } from "@neondatabase/serverless";

const url =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL;

if (!url) {
  console.error(
    "ERROR: No DATABASE_URL found. Set it in environment or run via Vercel dev."
  );
  process.exit(1);
}

const sql = neon(url);

console.log("Wiping all pipeline data...");

try {
  await sql`TRUNCATE TABLE
    outreach_emails,
    contacts,
    filtered_jobs,
    job_postings,
    agent_events,
    agent_runs,
    rate_limits,
    llm_cache
    RESTART IDENTITY CASCADE`;

  const [{ total: jobs }] = await sql`SELECT COUNT(*)::int AS total FROM job_postings`;
  const [{ total: filtered }] = await sql`SELECT COUNT(*)::int AS total FROM filtered_jobs`;

  console.log(`Done. job_postings=${jobs}, filtered_jobs=${filtered}`);
} catch (err) {
  console.error("Failed:", err.message);
  process.exit(1);
}
