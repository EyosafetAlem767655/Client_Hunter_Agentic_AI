import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAdminAuth } from "@/lib/auth";
import { enrichCompanyWithClay, isClayConfigured } from "@/lib/clay/client";
import { listEligibleLeadJobs, saveCompanyEnrichment, saveEnrichedContacts } from "@/lib/db/queries";

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  postingId: z.number().int().positive(),
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
    return NextResponse.json({ ok: false, error: "postingId is required" }, { status: 400 });
  }

  try {
    const { items } = await listEligibleLeadJobs({ page: 1, pageSize: 500 });
    const job = items.find((j) => j.postingId === body.postingId);
    if (!job) {
      return NextResponse.json(
        { ok: false, error: "Job not found or score below 60" },
        { status: 404 }
      );
    }

    const result = await enrichCompanyWithClay({
      company: job.company,
      jobTitle: job.title,
      jobUrl: job.url,
    });

    await saveCompanyEnrichment(body.postingId, {
      companyName: result.company.name ?? job.company,
      location: result.company.location,
      website: result.company.website,
      staffCount: result.company.staffCount,
      annualRevenue: result.company.annualRevenue,
      facilitiesCount: result.company.facilitiesCount,
      rawData: { company: result.company, leads: result.leads },
    });

    const contactsSaved = await saveEnrichedContacts(body.postingId, result.leads);

    return NextResponse.json({ ok: true, postingId: body.postingId, contactsSaved });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Enrichment failed" },
      { status: 500 }
    );
  }
}
