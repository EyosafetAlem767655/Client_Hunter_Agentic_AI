import { env } from "@/lib/env";
import { isSuppressed } from "@/lib/db/queries";
import { countDomainSendsInWindow, countEmailsSentToday } from "@/lib/db/queries";
import { isPersonalEmail } from "@/lib/email/compliance";
import { DraftedEmailSchema } from "@/lib/llm/schemas";
import { extractDomain } from "@/lib/utils";
import type { GuardrailResult } from "@/types";

const BANNED_PHRASES = ["FREE", "GUARANTEED", "URGENT", "ACT NOW", "WINNER"];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type SendContext = {
  recipientEmail: string;
  subject: string;
  body: string;
  llmOutput: unknown;
  agentEnabled: boolean;
  dryRun: boolean;
  confidence?: number;
};

export async function checkSuppression(
  email: string
): Promise<GuardrailResult> {
  if (await isSuppressed(email.toLowerCase())) {
    return { ok: false, reason: "Recipient is on suppression list" };
  }
  return { ok: true };
}

export async function checkDomainRateLimit(
  email: string
): Promise<GuardrailResult> {
  const domain = extractDomain(email);
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const count = await countDomainSendsInWindow(domain, since);
  if (count >= 1) {
    return { ok: false, reason: `Domain rate limit exceeded for ${domain}` };
  }
  return { ok: true };
}

export async function checkDailyLimit(): Promise<GuardrailResult> {
  const sent = await countEmailsSentToday();
  if (sent >= env.DAILY_EMAIL_LIMIT) {
    return { ok: false, reason: "Daily email limit exceeded" };
  }
  return { ok: true };
}

export function checkLlmValidation(output: unknown): GuardrailResult {
  const parsed = DraftedEmailSchema.safeParse(output);
  if (!parsed.success) {
    return { ok: false, reason: "LLM output failed validation" };
  }
  return { ok: true };
}

export function checkBodyLength(body: string): GuardrailResult {
  if (body.length < 100 || body.length > 1500) {
    return { ok: false, reason: "Body length out of range (100-1500)" };
  }
  return { ok: true };
}

export function checkPlaceholders(body: string): GuardrailResult {
  if (/\{\{[^}]+\}\}/.test(body)) {
    return { ok: false, reason: "Unresolved template placeholders" };
  }
  return { ok: true };
}

export function checkSubject(subject: string): GuardrailResult {
  if (!subject.trim()) {
    return { ok: false, reason: "Subject is empty" };
  }
  if (subject === subject.toUpperCase() && subject.length > 5) {
    return { ok: false, reason: "Subject is ALL CAPS" };
  }
  const upper = subject.toUpperCase();
  for (const phrase of BANNED_PHRASES) {
    if (upper.includes(phrase)) {
      return { ok: false, reason: `Banned phrase in subject: ${phrase}` };
    }
  }
  return { ok: true };
}

export function checkRecipientEmail(email: string): GuardrailResult {
  if (!EMAIL_REGEX.test(email)) {
    return { ok: false, reason: "Invalid recipient email format" };
  }
  if (isPersonalEmail(email)) {
    return { ok: false, reason: "Personal email domain not allowed" };
  }
  return { ok: true };
}

export function checkKillSwitch(agentEnabled: boolean): GuardrailResult {
  if (!agentEnabled) {
    return { ok: false, reason: "Agent is disabled (kill switch)" };
  }
  return { ok: true };
}

export function checkConfidence(
  confidence: number | undefined,
  dryRun: boolean
): GuardrailResult {
  if (dryRun) return { ok: true };
  if (confidence === undefined) return { ok: true };
  if (confidence < 0.6 && !env.ALLOW_LOW_CONFIDENCE_SEND) {
    return { ok: false, reason: "Contact confidence below threshold" };
  }
  return { ok: true };
}

export async function runAllGuardrails(
  ctx: SendContext
): Promise<GuardrailResult> {
  const checks: Array<GuardrailResult | Promise<GuardrailResult>> = [
    checkKillSwitch(ctx.agentEnabled),
    checkSuppression(ctx.recipientEmail),
    checkDomainRateLimit(ctx.recipientEmail),
    checkDailyLimit(),
    checkLlmValidation(ctx.llmOutput),
    checkBodyLength(ctx.body),
    checkPlaceholders(ctx.body),
    checkSubject(ctx.subject),
    checkRecipientEmail(ctx.recipientEmail),
    checkConfidence(ctx.confidence, ctx.dryRun),
  ];

  const results = await Promise.all(checks);
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    return { ok: false, reason: failed.map((f) => f.reason).join("; ") };
  }
  return { ok: true };
}
