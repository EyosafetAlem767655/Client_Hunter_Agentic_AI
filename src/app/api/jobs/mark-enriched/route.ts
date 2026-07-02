import { NextResponse } from "next/server";
import { z } from "zod";
import { markManuallyEnriched } from "@/lib/db/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  postingId: z.number().int().positive(),
});

export async function POST(request: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }

  try {
    await markManuallyEnriched(body.postingId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed" },
      { status: 500 }
    );
  }
}
