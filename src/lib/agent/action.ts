import { env, CRON_EMAIL_LIMIT, CONTACT_DISCOVERY_CONCURRENCY } from "@/lib/env";
import {
  discoverContactsForPosting,
  discoverFromBody,
  discoverViaGrokBatch,
  pickBestContact,
} from "@/lib/contact/discovery";
import type { DiscoveredContact } from "@/types";
import { isGrokConfigured } from "@/lib/llm/grok";
import { finalizeEmailBody } from "@/lib/email/templates";
import { sendEmail } from "@/lib/email/transport";
import { callOpenAIJson } from "@/lib/llm/client";
import { buildDraftPrompt, SYSTEM_PROMPT } from "@/lib/llm/prompts";
import {
  draftedEmailJsonSchema,
  parseDraftedEmail,
} from "@/lib/llm/schemas";
import { sha256Hex } from "@/lib/hash";
import { runAllGuardrails } from "./guardrails";
import { memory } from "./memory";
import { logEvent } from "./observability";
import { withConcurrency } from "./reasoning";

/**
 * Grok batch size. Smaller batches mean smaller per-call latency and a
 * higher hit rate — Grok's structured-output reliability drops fast once
 * we ask it about 5+ companies in one go, so we send 3 at a time.
 */
export const GROK_LOOKUP_BATCH_SIZE = 3;

/**
 * Two-phase discovery so we hit Grok in groups of 5:
 *   1. Cheap pass — pull any email already in the posting body.
 *   2. For remaining jobs, ask Grok in batches of 5 (concurrent).
 *   3. For anything Grok still couldn't find, fall back to the per-posting
 *      chain (on-site scrape → DDG homepage → DDG snippets → pattern guess).
 */
export async function discoverContactsForTopJobs(
  limit: number
): Promise<number> {
  const jobs = await memory.listTopRelevantWithoutContacts(limit);
  if (jobs.length === 0) return 0;

  let discovered = 0;
  const stillMissing: typeof jobs = [];

  // Phase 1: body emails (no network).
  for (const row of jobs) {
    const fromBody = discoverFromBody(row.posting.description);
    const best = pickBestContact(fromBody);
    if (best) {
      try {
        await memory.upsertContact({
          postingId: row.posting.id,
          email: best.email,
          sourceType: best.sourceType,
          confidence: best.confidence.toFixed(2),
        });
        discovered++;
      } catch (e) {
        await logEvent("warn", "Body-email upsert failed", {
          postingId: row.posting.id,
          error: e instanceof Error ? e.message : String(e),
        });
        stillMissing.push(row);
      }
    } else {
      stillMissing.push(row);
    }
  }

  // Phase 2: Grok batches of GROK_LOOKUP_BATCH_SIZE.
  const grokUnresolved: typeof stillMissing = [];
  if (isGrokConfigured() && stillMissing.length > 0) {
    const batches: Array<typeof stillMissing> = [];
    for (let i = 0; i < stillMissing.length; i += GROK_LOOKUP_BATCH_SIZE) {
      batches.push(stillMissing.slice(i, i + GROK_LOOKUP_BATCH_SIZE));
    }

    const batchOutcomes = await withConcurrency(
      batches,
      CONTACT_DISCOVERY_CONCURRENCY,
      async (batch) => {
        const inputs = batch.map(({ posting }) => ({
          company: posting.company,
          jobTitle: posting.title,
          jobUrl: posting.url,
        }));
        try {
          const map = await discoverViaGrokBatch(inputs);
          await logEvent("info", "Grok contact batch processed", {
            batchSize: batch.length,
            matched: map.size,
          });
          return { batch, map };
        } catch (error) {
          await logEvent("warn", "Grok contact batch failed", {
            batchSize: batch.length,
            error: error instanceof Error ? error.message : String(error),
          });
          return { batch, map: new Map<string, DiscoveredContact[]>() };
        }
      }
    );

    for (const { batch, map } of batchOutcomes) {
      for (const row of batch) {
        const contacts = map.get(row.posting.company) ?? [];
        const best = pickBestContact(contacts);
        if (!best) {
          grokUnresolved.push(row);
          continue;
        }
        try {
          await memory.upsertContact({
            postingId: row.posting.id,
            email: best.email,
            sourceType: best.sourceType,
            confidence: best.confidence.toFixed(2),
          });
          discovered++;
        } catch (e) {
          await logEvent("warn", "Grok contact upsert failed", {
            postingId: row.posting.id,
            error: e instanceof Error ? e.message : String(e),
          });
          grokUnresolved.push(row);
        }
      }
    }
  } else {
    grokUnresolved.push(...stillMissing);
  }

  // Phase 3: per-posting fallback chain (on-site / DDG / pattern). Skips Grok
  // internally since callers already tried it above.
  const fallbackResults = await withConcurrency(
    grokUnresolved,
    CONTACT_DISCOVERY_CONCURRENCY,
    async ({ posting }) => {
      try {
        const contacts = await discoverContactsForPosting(
          {
            description: posting.description,
            url: posting.url,
            company: posting.company,
          },
          // Already tried Grok in the batch phase; don't double-pay.
          { skipGrok: true }
        );
        const best = pickBestContact(contacts);
        if (!best) return false;
        await memory.upsertContact({
          postingId: posting.id,
          email: best.email,
          sourceType: best.sourceType,
          confidence: best.confidence.toFixed(2),
        });
        return true;
      } catch (error) {
        await logEvent("warn", "Fallback contact discovery failed", {
          postingId: posting.id,
          company: posting.company,
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    }
  );
  discovered += fallbackResults.filter(Boolean).length;

  return discovered;
}

export async function draftEmailsForContacts(
  limit: number,
  dryRun: boolean
): Promise<number> {
  const rows = await memory.listJobsNeedingDraft(limit);
  let drafted = 0;

  for (const { contact, posting, filtered } of rows) {
    const inputHash = sha256Hex(
      `${posting.id}:${contact.email}:${filtered.fitReason}`
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
            recipientEmail: contact.email,
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
    const confidence = Number(contact.confidence);
    const guard = await runAllGuardrails({
      recipientEmail: contact.email,
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
        to: contact.email,
        subject: email.subject,
        body: email.body,
        dryRun,
      });

      await memory.updateOutreachStatus(email.id, "sent", {
        sentAt: new Date(),
        messageId: result.messageId,
      });

      if (!dryRun) {
        const domain = contact.email.split("@")[1] ?? "";
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
  const confidence = Number(contact.confidence);

  const guard = await runAllGuardrails({
    recipientEmail: contact.email,
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
    to: contact.email,
    subject: email.subject,
    body: email.body,
    dryRun,
  });

  await memory.updateOutreachStatus(email.id, "sent", {
    sentAt: new Date(),
    messageId: result.messageId,
  });

  if (!dryRun) {
    const domain = contact.email.split("@")[1] ?? "";
    await memory.recordDomainSend(domain);
  }

  return { ok: true };
}
