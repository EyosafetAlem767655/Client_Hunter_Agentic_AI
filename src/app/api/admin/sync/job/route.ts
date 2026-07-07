import { NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/auth";
import {
  getJobPostingById,
  updateJobPostingDescription,
} from "@/lib/db/queries";
import { fetchFullDescription } from "@/lib/scrapers/fetch-description";
import { analyzeSinglePosting } from "@/lib/agent/reasoning";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Sync + re-analyze a SINGLE job posting.
 *
 * Re-fetches the full description from the source site (non-LinkedIn), then runs
 * a fresh LLM relevancy analysis on just that one posting and saves the updated
 * score + detailed reasoning. Scoped to one job on purpose — it never touches
 * the rest of the backlog.
 */
export async function POST(request: Request) {
  if (!verifyAdminAuth(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let postingId: number;
  try {
    const body = (await request.json()) as { postingId?: number };
    postingId = Number(body.postingId);
    if (!Number.isFinite(postingId)) throw new Error("invalid postingId");
  } catch {
    return NextResponse.json(
      { ok: false, error: "Body must be { postingId: number }" },
      { status: 400 }
    );
  }

  const job = await getJobPostingById(postingId);
  if (!job) {
    return NextResponse.json({ ok: false, error: "Job not found" }, { status: 404 });
  }

  // 1) Try to re-fetch the full description (skip LinkedIn — needs auth).
  let description = job.description;
  let descriptionUpdated = false;
  if (job.source !== "linkedin") {
    const fetched = await fetchFullDescription(job.url, job.source);
    if (fetched && fetched.length > (job.description?.length ?? 0) + 50) {
      await updateJobPostingDescription(job.id, fetched);
      description = fetched;
      descriptionUpdated = true;
    }
  }

  // 2) Fresh LLM analysis on the (possibly updated) description.
  try {
    const analysis = await analyzeSinglePosting(
      {
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        description,
        url: job.url,
      },
      { llmTimeoutMs: 40_000, llmMaxRetries: 2 }
    );

    return NextResponse.json({
      ok: true,
      descriptionUpdated,
      description,
      score: analysis.score,
      isRelevant: analysis.isRelevant,
      roleCategory: analysis.roleCategory,
      fitReason: analysis.fitReason,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        hint: "Ensure OPENAI_API_KEY is set. The description may have been updated even if analysis failed.",
        descriptionUpdated,
      },
      { status: 200 }
    );
  }
}
