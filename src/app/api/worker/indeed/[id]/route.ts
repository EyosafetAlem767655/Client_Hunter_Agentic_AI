import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyWorkerAuth } from "@/lib/auth";
import { ingestPostings } from "@/lib/agent/perception";
import { filterTechPostings } from "@/lib/agent/va-filter";
import { failIndeedScrape, finishIndeedScrape, getIndeedScrapeJob } from "@/lib/indeed-queue";
import { parseIngestPostings } from "@/lib/scraper/python-client";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), jobs: z.array(z.record(z.unknown())).max(250) }),
  z.object({ ok: z.literal(false), error: z.string().min(1).max(1000) }),
]);

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  if (!verifyWorkerAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0 || !(await getIndeedScrapeJob(id))) {
    return NextResponse.json({ error: "Queue job not found" }, { status: 404 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid worker result" }, { status: 400 });
  }
  if (!parsed.data.ok) {
    const job = await failIndeedScrape(id, parsed.data.error);
    return NextResponse.json({ ok: false, job });
  }

  try {
    const postings = filterTechPostings(parseIngestPostings(parsed.data.jobs));
    const result = await ingestPostings(postings);
    const job = await finishIndeedScrape(id, {
      fetched: result.scraped,
      inserted: result.inserted,
    });
    return NextResponse.json({ ok: true, job });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failIndeedScrape(id, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
