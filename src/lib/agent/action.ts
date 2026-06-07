import { env, CRON_EMAIL_LIMIT, CONTACT_DISCOVERY_CONCURRENCY } from "@/lib/env";
import {
  discoverContactsForPosting,
  discoverFromBody,
  pickBestContact,
} from "@/lib/contact/discovery";
import { finalizeEmailBody } from "@/lib/email/templates";
import { sendEmail } from "@/lib/email/transport";
import { callOpenAIJson } from "@/lib/llm/client";
import { buildDraftPrompt, SYSTEM_PROMPT } from "@/lib/llm/prompts";
import {
  draftedEmailJsonSchema,
  parseDraftedEmail,
} from "@/lib/llm/schemas";
import { sha256Hex } from "@/lib/hash";
import type { DiscoveredContact } from "@/types";
import { runAllGuardrails } from "./guardrails";
import { memory } from "./memory";
import { logEvent } from "./observability";
import { withConcurrency } from "./reasoning";

type DiscoveryMethod = "body" | "langsearch" | "url_only" | "fallback" | null;

interface DiscoveryResultRow {
  postingId: number;
  company: string;
  title: string;
  email: string | null;
  contactUrl: string | null;
  method: DiscoveryMethod;
}

function methodForContact(contact: DiscoveredContact | null): DiscoveryMethod {
  if (!contact) return null;
  switch (contact.sourceType) {
    case "listed":
      return "body";
    case "langsearch_scraped":
      return "langsearch";
    case "url_only":
      return "url_only";
    default:
      return "fallback";
  }
}

function postingUrlOnlyContact(url: string): DiscoveredContact {
  return {
    email: null,
    contactUrl: url,
    sourceType: "url_only",
    confidence: 0.2,
  };
}

async function persistDiscoveredContact(
  postingId: number,
  contact: DiscoveredContact
) {
  return memory.upsertContact({
    postingId,
    email: contact.email,
    contactUrl: contact.contactUrl ?? null,
    sourceType: contact.sourceType,
    confidence: contact.confidence.toFixed(2),
  });
}

async function discoverBestForPosting(posting: {
  id: number;
  description: string;
  url: string;
  company: string;
}): Promise<DiscoveredContact> {
  const fromBody = pickBestContact(discoverFromBody(posting.description));
  if (fromBody) return fromBody;

  const discovered = await discoverContactsForPosting({
    description: posting.description,
    url: posting.url,
    company: posting.company,
  });
  return pickBestContact(discovered) ?? postingUrlOnlyContact(posting.url);
}

/**
 * Process the next N pending jobs through contact discovery. Every attempted
 * relevant posting gets a contact row: a deliverable email when extraction
 * succeeds, otherwise a URL-only row for manual review and progress tracking.
 */
export async function discoverNextContacts(limit: number): Promise<{
  attempted: number;
  found: number;
  results: DiscoveryResultRow[];
}> {
  const slot = Math.max(1, Math.min(5, limit | 0));
  const jobs = await memory.listTopRelevantWithoutContacts(slot);
  const results: DiscoveryResultRow[] = [];
  if (jobs.length === 0) return { attempted: 0, found: 0, results };

  let found = 0;

  for (const row of jobs) {
    let best: DiscoveredContact;
    try {
      best = await discoverBestForPosting(row.posting);
      await persistDiscoveredContact(row.posting.id, best);
      found++;
    } catch (e) {
      best = postingUrlOnlyContact(row.posting.url);
      try {
        await persistDiscoveredContact(row.posting.id, best);
        found++;
      } catch (inner) {
        await logEvent("warn", "Contact discovery upsert failed", {
          postingId: row.posting.id,
          company: row.posting.company,
          error: inner instanceof Error ? inner.message : String(inner),
          discoveryError: e instanceof Error ? e.message : String(e),
        });
        results.push({
          postingId: row.posting.id,
          company: row.posting.company,
          title: row.posting.title,
          email: null,
          contactUrl: null,
          method: null,
        });
        continue;
      }
    }

    results.push({
      postingId: row.posting.id,
      company: row.posting.company,
      title: row.posting.title,
      email: best.email,
      contactUrl: best.contactUrl ?? null,
      method: methodForContact(best),
    });
  }

  return { attempted: jobs.length, found, results };
}

export async function discoverContactsForTopJobs(
  limit: number
): Promise<number> {
  const jobs = await memory.listTopRelevantWithoutContacts(limit);
  if (jobs.length === 0) return 0;

  const outcomes = await withConcurrency(
    jobs,
    CONTACT_DISCOVERY_CONCURRENCY,
    async ({ posting }) => {
      let best: DiscoveredContact;
      try {
        best = await discoverBestForPosting(posting);
      } catch (error) {
        await logEvent("warn", "Contact discovery failed; saving posting URL", {
          postingId: posting.id,
          company: posting.company,
          error: error instanceof Error ? error.message : String(error),
        });
        best = postingUrlOnlyContact(posting.url);
      }

      try {
        await persistDiscoveredContact(posting.id, best);
        return true;
      } catch (error) {
        await logEvent("warn", "Contact upsert failed", {
          postingId: posting.id,
          company: posting.company,
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    }
  );

  return outcomes.filter(Boolean).length;
}

export async function draftEmailsForContacts(
  limit: number,
  dryRun: boolean
): Promise<number> {
  const rows = await memory.listJobsNeedingDraft(limit);
  let drafted = 0;

  for (const { contact, posting, filtered } of rows) {
    if (!contact.email) continue;
    const recipientEmail = contact.email;
    const inputHash = sha256Hex(
      `${posting.id}:${recipientEmail}:${filtered.fitReason}`
    );
    const cached = await memory.getCachedLlm(env.OPENAI_DRAFT_MODEL, inputHash);
    let draft = cached ? parseDraftedEmail(cached) : null;

    if (!draft) {
      try {
        const raw = await callOpenAIJson<unknown>({
          model: env.OPENAI_DRAFT_MODEL,
          system: SYSTEM_PROMPT,
          user: buildDraftPrompt({
            title: posting.title,
            company: posting.company,
            fitReason: filtered.fitReason ?? "",
            roleCategory: filtered.roleCategory ?? "engineering",
            recipientEmail,
          }),
          jsonSchema: draftedEmailJsonSchema as Record<string, unknown>,
        });
        draft = parseDraftedEmail(raw);
        if (draft) {
          await memory.setCachedLlm(
            env.OPENAI_DRAFT_MODEL,
            inputHash,
            raw as Record<string, unknown>
          );
        }
      } catch (error) {
        await logEvent("error", "Draft LLM failed", {
          postingId: posting.id,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }

    if (!draft) continue;

    const body = finalizeEmailBody(draft.body);
    await memory.createOutreachEmail({
      contactId: contact.id,
      subject: draft.subject,
      body,
      dryRun,
      status: "pending",
    });
    drafted++;
  }

  return drafted;
}

export async function sendApprovedEmails(
  limit: number,
  dryRun: boolean,
  agentEnabled: boolean
): Promise<{ sent: number; failed: number }> {
  const pending = await memory.listPendingOutreach(
    Math.min(limit, CRON_EMAIL_LIMIT)
  );
  let sent = 0;
  let failed = 0;

  for (const { email, contact } of pending) {
    if (!contact.email) {
      await memory.updateOutreachStatus(email.id, "failed", {
        errorMessage: "Contact has no email address",
      });
      failed++;
      continue;
    }
    const recipientEmail = contact.email;
    const confidence = Number(contact.confidence);
    const guard = await runAllGuardrails({
      recipientEmail,
      subject: email.subject,
      body: email.body,
      llmOutput: { subject: email.subject, body: email.body },
      agentEnabled,
      dryRun,
      confidence,
    });

    if (!guard.ok) {
      await logEvent("warn", "Guardrails blocked send", {
        emailId: email.id,
        reason: guard.reason,
      });
      await memory.updateOutreachStatus(email.id, "failed", {
        errorMessage: guard.reason,
      });
      failed++;
      continue;
    }

    try {
      const result = await sendEmail({
        to: recipientEmail,
        subject: email.subject,
        body: email.body,
        dryRun,
      });

      await memory.updateOutreachStatus(email.id, "sent", {
        sentAt: new Date(),
        messageId: result.messageId,
      });

      if (!dryRun) {
        const domain = recipientEmail.split("@")[1] ?? "";
        await memory.recordDomainSend(domain);
      }

      sent++;
    } catch (error) {
      await memory.updateOutreachStatus(email.id, "failed", {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      failed++;
    }
  }

  return { sent, failed };
}

export async function sendSingleOutreach(
  outreachId: number,
  dryRun: boolean,
  agentEnabled: boolean
): Promise<{ ok: boolean; reason?: string }> {
  const row = await memory.getOutreachById(outreachId);
  if (!row) return { ok: false, reason: "Not found" };

  const { email, contact } = row;
  if (!contact.email) {
    return { ok: false, reason: "Contact has no email address" };
  }

  const recipientEmail = contact.email;
  const confidence = Number(contact.confidence);

  const guard = await runAllGuardrails({
    recipientEmail,
    subject: email.subject,
    body: email.body,
    llmOutput: { subject: email.subject, body: email.body },
    agentEnabled,
    dryRun,
    confidence,
  });

  if (!guard.ok) {
    await logEvent("warn", "Manual send blocked", { reason: guard.reason });
    return { ok: false, reason: guard.reason };
  }

  const result = await sendEmail({
    to: recipientEmail,
    subject: email.subject,
    body: email.body,
    dryRun,
  });

  await memory.updateOutreachStatus(email.id, "sent", {
    sentAt: new Date(),
    messageId: result.messageId,
  });

  if (!dryRun) {
    const domain = recipientEmail.split("@")[1] ?? "";
    await memory.recordDomainSend(domain);
  }

  return { ok: true };
}
