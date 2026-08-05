import { NextResponse } from "next/server";
import { verifyWorkerAuth } from "@/lib/auth";
import { claimNextIndeedScrape } from "@/lib/indeed-queue";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!verifyWorkerAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const workerId = new URL(request.url).searchParams.get("workerId")?.trim();
  if (!workerId) {
    return NextResponse.json({ error: "workerId is required" }, { status: 400 });
  }
  const job = await claimNextIndeedScrape(workerId.slice(0, 120));
  if (!job) return new NextResponse(null, { status: 204 });
  return NextResponse.json({
    job: { id: job.id, query: job.query, requestedAt: job.requestedAt },
  });
}
