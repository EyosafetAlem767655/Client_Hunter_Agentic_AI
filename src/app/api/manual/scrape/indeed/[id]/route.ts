import { NextResponse } from "next/server";
import { verifyManualAuth } from "@/lib/auth";
import { getIndeedScrapeJob } from "@/lib/indeed-queue";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  if (!verifyManualAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = Number(params.id);
  const job = Number.isSafeInteger(id) ? await getIndeedScrapeJob(id) : null;
  if (!job) return NextResponse.json({ error: "Queue job not found" }, { status: 404 });
  return NextResponse.json({
    ok: job.status === "completed",
    jobId: job.id,
    status: job.status,
    count: job.fetched,
    inserted: job.inserted,
    error: job.error,
  });
}
