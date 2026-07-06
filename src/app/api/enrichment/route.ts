import { NextResponse } from "next/server";
import { listEnrichedJobs } from "@/lib/db/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const pageSize = Math.min(500, Math.max(1, Number(searchParams.get("pageSize") ?? "100")));

  try {
    const result = await listEnrichedJobs({ page, pageSize });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Query failed" },
      { status: 500 }
    );
  }
}
