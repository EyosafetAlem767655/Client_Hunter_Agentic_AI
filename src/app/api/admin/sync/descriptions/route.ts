import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { verifyAdminAuth } from "@/lib/auth";
import {
  listJobsWithShortDescriptions,
  updateJobPostingDescription,
} from "@/lib/db/queries";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function fetchFullDescription(
  url: string,
  source: string
): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);
    $("script, style, noscript, nav, header, footer").remove();

    // Indeed-specific selectors
    if (source === "indeed") {
      const sel = $(
        "#jobDescriptionText, [data-testid='jobsearch-jobDescriptionText'], .jobsearch-JobComponent-description"
      ).first();
      const text = sel.text().replace(/\s+/g, " ").trim();
      if (text.length > 150) return text.slice(0, 8_000);
    }

    // LinkedIn-specific selectors (may or may not be accessible without auth)
    if (source === "linkedin") {
      const sel = $(
        ".description__text, .show-more-less-html__markup, [class*='job-description']"
      ).first();
      const text = sel.text().replace(/\s+/g, " ").trim();
      if (text.length > 150) return text.slice(0, 8_000);
    }

    // Generic: try common job description containers by class/id patterns
    const genericSelectors = [
      "[class*='job-description']",
      "[class*='jobDescription']",
      "[class*='job_description']",
      "[id*='job-description']",
      "[id*='jobDescription']",
      "[data-automation='jobDescription']",
      "[data-cy='job-description']",
      ".posting-requirements",
      "article",
    ];
    for (const sel of genericSelectors) {
      const el = $(sel).first();
      if (!el.length) continue;
      const text = el.text().replace(/\s+/g, " ").trim();
      if (text.length > 300) return text.slice(0, 8_000);
    }

    // Last resort: largest text block in <main> or <body>
    const mainText = $("main").text().replace(/\s+/g, " ").trim();
    if (mainText.length > 500) return mainText.slice(0, 8_000);

    return null;
  } catch {
    return null;
  }
}

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
