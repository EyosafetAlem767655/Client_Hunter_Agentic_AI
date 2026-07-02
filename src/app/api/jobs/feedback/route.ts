import { NextRequest, NextResponse } from "next/server";
import { saveJobFeedback, listAllFeedback } from "@/lib/db/queries";
import { verifyManualAuth } from "@/lib/auth";

const VALID_RATINGS = ["1", "2", "3", "4", "5"];

export async function GET(req: NextRequest) {
  if (!verifyManualAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const entries = await listAllFeedback();
    return NextResponse.json({ ok: true, entries });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      postingId: number;
      feedback: string;
      notes?: string;
    };
    if (
      typeof body.postingId !== "number" ||
      !VALID_RATINGS.includes(body.feedback)
    ) {
      return NextResponse.json({ ok: false, error: "Invalid input" }, { status: 400 });
    }
    const notes = (body.notes ?? "").trim();
    if (!notes) {
      return NextResponse.json(
        { ok: false, error: "A comment is required before saving" },
        { status: 400 }
      );
    }
    await saveJobFeedback(body.postingId, body.feedback, notes);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Error" },
      { status: 500 }
    );
  }
}
