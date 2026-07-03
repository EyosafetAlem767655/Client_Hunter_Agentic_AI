import { NextRequest, NextResponse } from "next/server";
import { closePut, closeDelete, isCloseConfigured } from "@/lib/close/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function notConfigured() {
  return NextResponse.json({ error: "CLOSE_API_KEY not configured" }, { status: 400 });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isCloseConfigured()) return notConfigured();
  try {
    const body = await req.json() as unknown;
    const data = await closePut(`/task/${params.id}/`, body);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isCloseConfigured()) return notConfigured();
  try {
    await closeDelete(`/task/${params.id}/`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
