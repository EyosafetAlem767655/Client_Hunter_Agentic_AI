import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAdminAuth } from "@/lib/auth";
import { env } from "@/lib/env";
import { findAndSendDomain } from "@/lib/clay/domain-finder";
import { getJobPostingById, saveCompanyEnrichment } from "@/lib/db/queries";

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

  const missing = [
    !env.ANTHROPIC_API_KEY && "ANTHROPIC_API_KEY",
    !env.CLAY_WEBHOOK_URL && "CLAY_WEBHOOK_URL",
    !env.CLAY_AUTH_TOKEN && "CLAY_AUTH_TOKEN",
    !env.LANGSEARCH_API_KEY && "LANGSEARCH_API_KEY",
  ].filter(Boolean);
  if (missing.length > 0) {
    return NextResponse.json(
      { ok: false, error: `Not configured — set: ${missing.join(", ")}` },
      { status: 400 }
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ ok: false, error: "postingId is required" }, { status: 400 });
  }

  const job = await getJobPostingById(body.postingId);
  if (!job) {
    return NextResponse.json({ ok: false, error: "Job not found" }, { status: 404 });
  }

  try {
    const result = await findAndSendDomain(job.company, body.postingId);

    // Record the attempt. "pending" while we wait for Clay's callback to post
    // the enriched leads back; the /api/webhooks/clay receiver flips it to
    // "complete" and saves the contacts.
    await saveCompanyEnrichment(body.postingId, {
      companyName: job.company,
      location: null,
      website: result.domain,
      staffCount: null,
      annualRevenue: null,
      facilitiesCount: null,
      status: result.sent ? "pending" : "complete",
      rawData: {
        provider: "clay",
        domain: result.domain,
        reasoning: result.reasoning,
        checkedDomains: result.checked,
        sentToClay: result.sent,
      },
    });

    return NextResponse.json({
      ok: true,
      postingId: body.postingId,
      domain: result.domain,
      reasoning: result.reasoning,
      sent: result.sent,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Enrichment failed" },
      { status: 500 }
    );
  }
}
