import { env, CRON_EMAIL_LIMIT, CONTACT_DISCOVERY_CONCURRENCY } from "@/lib/env";
import { discoverContactsForPosting, pickBestContact } from "@/lib/contact/discovery";
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

export async function discoverContactsForTopJobs(
  limit: number
): Promise<number> {
  const jobs = await memory.listTopRelevantWithoutContacts(limit);

  const results = await withConcurrency(
    jobs,
    CONTACT_DISCOVERY_CONCURRENCY,
    async ({ posting }) => {
      try {
        const contacts = await discoverContactsForPosting({
          description: posting.description,
          url: posting.url,
          company: posting.company,
        });
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
        await logEvent("warn", "Contact discovery failed for posting", {
          postingId: posting.id,
          company: posting.company,
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    }
  );

  return results.filter(Boolean).length;
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
