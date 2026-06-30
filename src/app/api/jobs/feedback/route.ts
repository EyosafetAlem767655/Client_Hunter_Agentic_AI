import { NextRequest, NextResponse } from "next/server";
import { saveJobFeedback } from "@/lib/db/queries";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      postingId: number;
      feedback: string;
      notes?: string;
    };
    if (
      typeof body.postingId !== "number" ||
      !["good", "bad"].includes(body.feedback)
    ) {
      return NextResponse.json({ ok: false, error: "Invalid input" }, { status: 400 });
    }
    await saveJobFeedback(body.postingId, body.feedback, body.notes ?? null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Error" },
      { status: 500 }
    );
  }
}
