import { NextResponse } from "next/server";
import { listOutreachPaginated } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") ?? undefined;
  const page = Number(searchParams.get("page") ?? "1");
  const pageSize = Number(searchParams.get("pageSize") ?? "20");

  const result = await listOutreachPaginated({ status, page, pageSize });

  return NextResponse.json({
    items: result.items,
    page,
    pageSize,
    total: result.total,
  });
}
