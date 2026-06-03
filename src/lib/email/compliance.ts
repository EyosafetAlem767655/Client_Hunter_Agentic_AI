import { env } from "@/lib/env";

const PERSONAL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "aol.com",
  "protonmail.com",
  "live.com",
  "msn.com",
]);

export function isPersonalEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return domain ? PERSONAL_DOMAINS.has(domain) : true;
}

export function gdprNote(): string {
  return "We process business contact data solely for recruitment outreach; request deletion via our unsubscribe link.";
}

export function buildListUnsubscribeHeaders(): Record<string, string> {
  return {
    "List-Unsubscribe": `<mailto:${env.UNSUBSCRIBE_MAILTO}>, <${env.UNSUBSCRIBE_URL}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export function canSendToRecipient(email: string): boolean {
  return !isPersonalEmail(email);
}
