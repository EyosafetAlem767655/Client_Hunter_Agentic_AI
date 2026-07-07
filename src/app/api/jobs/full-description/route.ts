import { NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/auth";
import {
  getJobPostingById,
  updateJobPostingDescription,
} from "@/lib/db/queries";
import { fetchFullDescription } from "@/lib/scrapers/fetch-description";
import { callOpenAIJson } from "@/lib/llm/client";
import { env } from "@/lib/env";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FORMAT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { description: { type: "string" } },
  required: ["description"],
};

const FORMAT_SYSTEM =
  "You reformat raw scraped job-posting text into clean, readable plain text. " +
  "Preserve ALL information verbatim — never invent, summarize, translate, or drop " +
  "anything. Fix run-on text and spacing, add paragraph breaks, and turn lists of " +
  "responsibilities/requirements/benefits into simple bullet lines starting with '- '. " +
  "Return only the reformatted description text in the `description` field.";

/** Best-effort LLM cleanup. Falls back to the raw text on any failure. */
async function formatDescription(raw: string): Promise<string> {
  try {
    const out = await callOpenAIJson<{ description: string }>({
      model: env.OPENAI_FILTER_MODEL,
      system: FORMAT_SYSTEM,
      user: raw.slice(0, 12_000),
      jsonSchema: FORMAT_SCHEMA,
      timeoutMs: 40_000,
      maxRetries: 2,
    });
    const text = out.description?.trim();
    return text && text.length > 50 ? text : raw;
  } catch {
    return raw;
  }
}

/**
 * On-demand: re-scrape ONE job's detail page (via its stored URL) to pull the
 * full description, optionally clean it up with the LLM, persist it, and return
 * it. Scoped to a single posting — triggered by the "See full job description"
 * button in the job detail modal.
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

  const full = await fetchFullDescription(job.url, job.source);
  const currentLen = job.description?.length ?? 0;

  // Only accept a meaningfully fuller result — otherwise report that the source
  // page couldn't be read (Indeed/LinkedIn often block automated fetches).
  if (!full || full.length < 200 || full.length <= currentLen + 100) {
    return NextResponse.json({
      ok: false,
      error:
        "Couldn't retrieve a fuller description from the source page — the site may block automated access (common for Indeed and LinkedIn). Open the original posting to read it.",
    });
  }

  const formatted = await formatDescription(full);
  await updateJobPostingDescription(job.id, formatted);

  return NextResponse.json({ ok: true, description: formatted });
}
