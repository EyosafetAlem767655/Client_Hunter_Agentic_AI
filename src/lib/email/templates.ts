import { env } from "@/lib/env";
import { gdprNote } from "./compliance";

export function applyTemplatePlaceholders(body: string): string {
  return body
    .replace(/\{\{BUSINESS_NAME\}\}/g, env.BUSINESS_NAME)
    .replace(/\{\{BUSINESS_ADDRESS\}\}/g, env.BUSINESS_ADDRESS)
    .replace(/\{\{UNSUBSCRIBE_URL\}\}/g, env.UNSUBSCRIBE_URL);
}

export function buildEmailFooter(): string {
  return `

---
${env.BUSINESS_NAME}
${env.BUSINESS_ADDRESS}

Unsubscribe: ${env.UNSUBSCRIBE_URL}
${gdprNote()}`;
}

export function finalizeEmailBody(draftBody: string): string {
  const withPlaceholders = applyTemplatePlaceholders(draftBody);
  if (withPlaceholders.includes(env.UNSUBSCRIBE_URL)) {
    return withPlaceholders;
  }
  return withPlaceholders + buildEmailFooter();
}
