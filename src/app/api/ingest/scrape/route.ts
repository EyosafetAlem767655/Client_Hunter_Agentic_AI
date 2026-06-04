import { NextResponse } from "next/server";
import { z } from "zod";
import { runScrapePipelineFromPostings } from "@/lib/agent/orchestrator";
import { parseIngestPostings } from "@/lib/scraper/python-client";
import { verifyIngestAuth } from "@/lib/auth";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  postings: z.array(z.record(z.unknown())).optional(),
});

export async function POST(request: Request) {
  if (!verifyIngestAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const postings = parseIngestPostings(parsed.data.postings ?? []);
  const summary = await runScrapePipelineFromPostings(postings);
  return NextResponse.json(summary);
}
