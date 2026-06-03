import { createHash, randomUUID } from "crypto";
import nodemailer from "nodemailer";
import { env } from "@/lib/env";
import { buildListUnsubscribeHeaders } from "./compliance";

export function createTransport() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: env.GMAIL_USER,
      pass: env.GMAIL_APP_PASSWORD,
    },
  });
}

export function generateMessageId(): string {
  const domain = env.GMAIL_USER.split("@")[1] ?? "talentbridge.local";
  return `<${randomUUID()}@${domain}>`;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
  dryRun: boolean;
}

export interface SendEmailResult {
  messageId: string;
  dryRun: boolean;
}

export async function sendEmail(
  params: SendEmailParams
): Promise<SendEmailResult> {
  const messageId = generateMessageId();
  const headers = buildListUnsubscribeHeaders();

  if (params.dryRun) {
    return { messageId, dryRun: true };
  }

  const transport = createTransport();
  await transport.sendMail({
    from: `${env.BUSINESS_NAME} <${env.GMAIL_USER}>`,
    to: params.to,
    subject: params.subject,
    text: params.body,
    messageId,
    headers,
  });

  return { messageId, dryRun: false };
}

export function hashRecipient(email: string): string {
  return createHash("sha256").update(email.toLowerCase()).digest("hex");
}
