import { NextRequest, NextResponse } from "next/server";
import { parseSpreadsheet, rowsToLeads } from "@/lib/close/csv-import";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Parse an uploaded .csv/.xlsx of enriched contacts into Close leads and hand
 * them back for preview. Nothing is written to Close here — the client posts
 * the reviewed leads to /api/crm/close/import to commit them.
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File is ${(file.size / 1e6).toFixed(1)} MB — the limit is 5 MB.` },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const rows = parseSpreadsheet(buffer);
    if (rows.length === 0) {
      return NextResponse.json({ error: "The file has no data rows." }, { status: 400 });
    }

    return NextResponse.json(rowsToLeads(rows));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not read that file" },
      { status: 400 }
    );
  }
}
