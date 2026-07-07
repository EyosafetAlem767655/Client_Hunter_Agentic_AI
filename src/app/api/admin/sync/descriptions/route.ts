import { NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/auth";
import {
  listJobsWithShortDescriptions,
  updateJobPostingDescription,
} from "@/lib/db/queries";
import { fetchFullDescription } from "@/lib/scrapers/fetch-description";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!verifyAdminAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const n = Math.max(1, Math.min(30, Number(url.searchParams.get("n") ?? 20)));
  const minLen = 500; // jobs with description shorter than this are candidates
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000); // last 24 hours only

  const jobs = await listJobsWithShortDescriptions(n, minLen, since);

  let updated = 0;
  let skipped = 0;
  const details: Array<{ id: number; title: string; result: string }> = [];

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];

    // Polite delay between requests
    if (i > 0) await new Promise((r) => setTimeout(r, 800));

    const fetched = await fetchFullDescription(job.url, job.source);

    if (fetched && fetched.length > (job.description?.length ?? 0) + 50) {
      await updateJobPostingDescription(job.id, fetched);
      updated++;
      details.push({
        id: job.id,
        title: job.title,
        result: `updated (${fetched.length} chars from ${job.description?.length ?? 0})`,
      });
    } else {
      skipped++;
      details.push({
        id: job.id,
        title: job.title,
        result: fetched ? `no improvement (${fetched.length} vs ${job.description?.length ?? 0})` : "fetch failed / blocked",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    total: jobs.length,
    updated,
    skipped,
    details,
    note: "Run the filter pipeline next to regenerate AI reasoning with the updated descriptions.",
  });
}
