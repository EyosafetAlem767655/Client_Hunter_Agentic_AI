import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAdminAuth } from "@/lib/auth";
import { enrichCompanyWithClay, isClayConfigured } from "@/lib/clay/client";
import { listLeadStatusJobs, saveClayContacts, getSetting } from "@/lib/db/queries";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  postingId: z.number().int().positive().optional(),
});

export async function POST(request: NextRequest) {
  if (!verifyAdminAuth(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!isClayConfigured()) {
    return NextResponse.json(
      { ok: false, error: "CLAY_API_KEY not configured" },
      { status: 400 }
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }

  try {
    if (body.postingId !== undefined) {
      // Single-job enrichment
      const { items } = await listLeadStatusJobs({ tier: "high", page: 1, pageSize: 200 });
      const job = items.find((j) => j.posting.id === body.postingId);
      if (!job) {
        return NextResponse.json(
          { ok: false, error: "Job not found or not in high-tier" },
          { status: 404 }
        );
      }
      const contacts = await enrichCompanyWithClay({
        company: job.posting.company,
        jobTitle: job.posting.title,
        jobUrl: job.posting.url,
      });
      const contactsSaved = await saveClayContacts(body.postingId, contacts);
      return NextResponse.json({ ok: true, postingId: body.postingId, contactsSaved });
    }

    // Batch mode — auto-enrich pending high-tier jobs (cap at 3 for Vercel 60s limit)
    const autoMode = (await getSetting("clay_auto_enrich_enabled")) === "true";
    if (!autoMode) {
      return NextResponse.json(
        { ok: false, error: "Auto-enrich is disabled. Toggle AUTO mode first." },
        { status: 400 }
      );
    }

    const { items } = await listLeadStatusJobs({ tier: "high", page: 1, pageSize: 200 });
    const pending = items.filter((j) => !j.isEnriched).slice(0, 3);

    let totalSaved = 0;
    const errors: string[] = [];

    for (const job of pending) {
      try {
        const clayContacts = await enrichCompanyWithClay({
          company: job.posting.company,
          jobTitle: job.posting.title,
          jobUrl: job.posting.url,
        });
        totalSaved += await saveClayContacts(job.posting.id, clayContacts);
      } catch (e) {
        errors.push(
          `${job.posting.company}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }

    return NextResponse.json({
      ok: true,
      enriched: pending.length,
      contactsSaved: totalSaved,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Enrichment failed" },
      { status: 500 }
    );
  }
}
