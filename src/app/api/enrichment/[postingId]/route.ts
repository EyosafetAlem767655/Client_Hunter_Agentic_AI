import { NextResponse } from "next/server";
import { getEnrichmentDetail } from "@/lib/db/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRACTICE_TITLES: Record<"solo" | "mid", string[]> = {
  solo: [
    "Owner / Practice Owner",
    "Physician Owner / MD Owner / Dentist Owner",
    "Office Manager / Medical Office Manager",
    "Practice Manager",
  ],
  mid: [
    "Practice Administrator",
    "Practice Manager / Operations Manager",
    "Office Manager / Front Office Manager",
    "Director of Operations",
    "Billing Manager / Revenue Cycle Manager",
  ],
};

function getTargetedTitles(practiceSize: string | null): string[] {
  if (practiceSize === "solo") return PRACTICE_TITLES.solo;
  if (practiceSize === "mid") return PRACTICE_TITLES.mid;
  return [...PRACTICE_TITLES.solo, ...PRACTICE_TITLES.mid];
}

export async function GET(
  _request: Request,
  { params }: { params: { postingId: string } }
) {
  const postingId = Number(params.postingId);
  if (!Number.isInteger(postingId) || postingId <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid postingId" }, { status: 400 });
  }

  try {
    const { enrichment, leads } = await getEnrichmentDetail(postingId);
    return NextResponse.json({
      enrichment,
      leads,
      targetedTitles: getTargetedTitles(enrichment?.practiceSize ?? null),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed to load enrichment" },
      { status: 500 }
    );
  }
}
