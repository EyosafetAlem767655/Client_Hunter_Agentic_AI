import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  companyEnrichments,
  contacts,
  filteredJobs,
  jobPostings,
  outreachEmails,
} from "@/lib/db/schema";
import { and, count, inArray, isNotNull, lt, sql } from "drizzle-orm";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();

  // ── Step 1: Null out old feedback (keep the filtered_jobs row) ────────────
  const tenDaysAgo = sql`NOW() - INTERVAL '10 days'`;

  const [feedbackRow] = await db
    .select({ feedbackCleared: count() })
    .from(filteredJobs)
    .where(and(isNotNull(filteredJobs.feedbackAt), lt(filteredJobs.feedbackAt, tenDaysAgo)));

  const feedbackCleared = feedbackRow?.feedbackCleared ?? 0;

  if (feedbackCleared > 0) {
    await db
      .update(filteredJobs)
      .set({ userFeedback: null, userNotes: null, feedbackAt: null })
      .where(and(isNotNull(filteredJobs.feedbackAt), lt(filteredJobs.feedbackAt, tenDaysAgo)));
  }

  // ── Step 2: Delete old job postings in FK dependency order ───────────────
  const oldPostingRows = await db
    .select({ id: jobPostings.id })
    .from(jobPostings)
    .where(lt(jobPostings.scrapedAt, sql`NOW() - INTERVAL '30 days'`));

  const oldIds = oldPostingRows.map((r) => r.id);

  if (oldIds.length > 0) {
    const oldContactRows = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(inArray(contacts.postingId, oldIds));

    const oldContactIds = oldContactRows.map((c) => c.id);

    if (oldContactIds.length > 0) {
      await db.delete(outreachEmails).where(inArray(outreachEmails.contactId, oldContactIds));
    }
    await db.delete(contacts).where(inArray(contacts.postingId, oldIds));
    await db.delete(companyEnrichments).where(inArray(companyEnrichments.postingId, oldIds));
    await db.delete(filteredJobs).where(inArray(filteredJobs.postingId, oldIds));
    await db.delete(jobPostings).where(inArray(jobPostings.id, oldIds));
  }

  return NextResponse.json({
    feedbackCleared,
    postingsDeleted: oldIds.length,
    ranAt: new Date().toISOString(),
  });
}
