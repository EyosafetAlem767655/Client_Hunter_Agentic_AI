import { and, desc, eq, gte } from "drizzle-orm";
import { env } from "@/lib/env";
import { getDb } from "@/lib/db";
import { filteredJobs, jobPostings } from "@/lib/db/schema";
import { createTransport, generateMessageId } from "./transport";
import { logEvent } from "@/lib/agent/observability";

interface DigestRow {
  title: string;
  company: string;
  location: string;
  url: string;
  score: number;
  fitReason: string | null;
  roleCategory: string | null;
  estimatedSalaryRange: string | null;
}

export async function getTodaysVaDigestRows(limit = 25): Promise<DigestRow[]> {
  const db = getDb();
  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const rows = await db
    .select({
      title: jobPostings.title,
      company: jobPostings.company,
      location: jobPostings.location,
      url: jobPostings.url,
      score: filteredJobs.score,
      fitReason: filteredJobs.fitReason,
      roleCategory: filteredJobs.roleCategory,
      estimatedSalaryRange: filteredJobs.estimatedSalaryRange,
    })
    .from(filteredJobs)
    .innerJoin(jobPostings, eq(jobPostings.id, filteredJobs.postingId))
    .where(
      and(
        eq(filteredJobs.isRelevant, true),
        gte(filteredJobs.filteredAt, since)
      )
    )
    .orderBy(desc(filteredJobs.score))
    .limit(limit);

  return rows;
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderDigestHtml(rows: DigestRow[]): string {
  const today = new Date().toISOString().slice(0, 10);
  const intro = `
    <p style="margin:0 0 16px 0;font-size:15px;color:#1f2937;">
      Here are the top <strong>virtual-assistant &amp; remote support</strong>
      openings at US / European companies scraped today.
    </p>
    <p style="margin:0 0 24px 0;font-size:14px;color:#4b5563;">
      Each of these employers is paying full US/EU rates for back-office work.
      <strong>${htmlEscape(env.BUSINESS_NAME)}</strong> can place fully-vetted
      talent from the Philippines, India, or Ethiopia at <strong>40-60% lower
      cost</strong> with comparable or better efficiency. Reply to this email
      to start a placement conversation.
    </p>
  `;

  if (rows.length === 0) {
    return `
      <div style="font-family:Helvetica,Arial,sans-serif;max-width:680px;margin:0 auto;padding:24px;background:#f9fafb;">
        <h2 style="color:#111827;margin:0 0 12px 0;">TalentBridge VA digest — ${today}</h2>
        ${intro}
        <p style="font-size:14px;color:#6b7280;">No new VA-eligible postings matched today's scrape. The pipeline will keep watching.</p>
      </div>
    `;
  }

  const items = rows
    .map(
      (r) => `
      <tr>
        <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;vertical-align:top;">
          <div style="font-weight:600;font-size:15px;color:#111827;">
            <a href="${htmlEscape(r.url)}" style="color:#4f46e5;text-decoration:none;">
              ${htmlEscape(r.title)}
            </a>
          </div>
          <div style="font-size:13px;color:#6b7280;margin-top:2px;">
            ${htmlEscape(r.company)} · ${htmlEscape(r.location || "Remote")}
            ${r.roleCategory ? ` · ${htmlEscape(r.roleCategory)}` : ""}
            ${r.estimatedSalaryRange ? ` · ${htmlEscape(r.estimatedSalaryRange)}` : ""}
          </div>
          ${
            r.fitReason
              ? `<div style="font-size:13px;color:#374151;margin-top:6px;">${htmlEscape(r.fitReason)}</div>`
              : ""
          }
        </td>
        <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;text-align:right;vertical-align:top;">
          <span style="display:inline-block;padding:4px 10px;border-radius:9999px;background:#ede9fe;color:#5b21b6;font-weight:600;font-size:12px;">
            ${r.score}
          </span>
        </td>
      </tr>
    `
    )
    .join("");

  return `
    <div style="font-family:Helvetica,Arial,sans-serif;max-width:720px;margin:0 auto;padding:24px;background:#f9fafb;">
      <h2 style="color:#111827;margin:0 0 4px 0;">TalentBridge VA digest</h2>
      <div style="font-size:13px;color:#6b7280;margin-bottom:20px;">${today} · ${rows.length} matched roles</div>
      ${intro}
      <table style="width:100%;border-collapse:collapse;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
        ${items}
      </table>
      <p style="font-size:12px;color:#9ca3af;margin-top:20px;">
        Sent by ${htmlEscape(env.BUSINESS_NAME)} · ${htmlEscape(env.BUSINESS_ADDRESS)}
      </p>
    </div>
  `;
}

export function renderDigestText(rows: DigestRow[]): string {
  if (rows.length === 0) {
    return `TalentBridge VA digest\n\nNo new VA-eligible postings matched today's scrape.\n`;
  }
  const lines = rows.map(
    (r, i) =>
      `${i + 1}. [${r.score}] ${r.title} — ${r.company} (${r.location || "Remote"})\n   ${r.url}${r.fitReason ? `\n   ${r.fitReason}` : ""}`
  );
  return `TalentBridge VA digest\n\nTop ${rows.length} VA / remote-support openings at US/EU employers scraped today.\nTalentBridge can fill any of these from our Philippines / India / Ethiopia talent pool at 40-60% lower cost with equal or better efficiency.\n\n${lines.join("\n\n")}\n`;
}

export async function sendDailyDigest(
  options: { dryRun?: boolean; limit?: number } = {}
): Promise<{ sent: boolean; count: number; messageId?: string; dryRun: boolean }> {
  const rows = await getTodaysVaDigestRows(options.limit ?? 25);
  const dryRun = options.dryRun ?? false;
  const messageId = generateMessageId();

  if (dryRun) {
    await logEvent("info", "Digest email skipped (dry run)", { count: rows.length });
    return { sent: false, count: rows.length, dryRun: true, messageId };
  }

  try {
    const transport = createTransport();
    const subject =
      rows.length === 0
        ? `TalentBridge VA digest — no matches today`
        : `TalentBridge VA digest — ${rows.length} VA roles at US/EU employers`;

    await transport.sendMail({
      from: `${env.BUSINESS_NAME} <${env.GMAIL_USER}>`,
      to: env.CONTACT_EMAIL,
      subject,
      text: renderDigestText(rows),
      html: renderDigestHtml(rows),
      messageId,
    });
    await logEvent("info", "Digest email sent", {
      to: env.CONTACT_EMAIL,
      count: rows.length,
    });
    return { sent: true, count: rows.length, messageId, dryRun: false };
  } catch (error) {
    await logEvent("error", "Digest email failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { sent: false, count: rows.length, dryRun: false };
  }
}
