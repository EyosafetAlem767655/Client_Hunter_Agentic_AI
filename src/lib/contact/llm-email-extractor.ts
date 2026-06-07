import { env } from "@/lib/env";
import { callOpenAIJson } from "@/lib/llm/client";
import { logEvent } from "@/lib/agent/observability";
import type { ScrapedContactPage } from "./python-scraper";

interface ExtractedEmails {
  /** Best single email to email cold for this company. */
  primary: string | null;
  /** Other plausible contacts, ranked. */
  alternates: string[];
}

const SYSTEM_PROMPT = `You extract business contact emails from scraped \
contact pages. Given a company's contact page text and any mailto: links \
found on the page, return the single best email to use for cold outreach \
plus a small list of alternates.

Rules:
- Prefer role-based addresses (careers@, jobs@, hiring@, hr@, recruiting@, \
hello@, contact@, info@) over personal addresses (john@, jane.smith@).
- Skip noreply / no-reply / postmaster / abuse / privacy@ — those don't \
read incoming mail.
- Skip emails that belong to ATS / tracker / analytics domains (sentry.io, \
googleapis.com, github.com, gravatar.com, wix.com, etc.) — they aren't \
the company's mailbox.
- If the page lists multiple departments, the recruiting / HR address wins.
- If you can't find any usable email, return primary: null.
- Return ONLY emails actually visible in the source. Do not invent.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    primary: { type: ["string", "null"] },
    alternates: {
      type: "array",
      items: { type: "string" },
      maxItems: 5,
    },
  },
  required: ["primary", "alternates"],
} as const;

function buildUserPrompt(pages: ScrapedContactPage[]): string {
  const blocks = pages.map((p, i) => {
    const mailtos = p.mailtos.length
      ? `mailto: links: ${p.mailtos.join(", ")}`
      : "mailto: links: (none)";
    // Cap each page at ~6k chars — emails almost always appear in the
    // first screen of a contact page; sending more wastes tokens.
    const trimmed = (p.text ?? "").slice(0, 6_000);
    return [
      `=== Page ${i + 1}: ${p.url} (engine: ${p.engine}) ===`,
      mailtos,
      "",
      trimmed,
    ].join("\n");
  });
  return [
    "Below are the scraped contents of one or more contact pages for a single company.",
    "Return JSON: { primary, alternates }.",
    "",
    ...blocks,
  ].join("\n");
}

/**
 * Send the scraped contact-page content to OpenAI and let the model pick
 * the right business contact email. Returns primary first, then the
 * model's alternates. Empty list on parse / API failure.
 */
export async function extractEmailsFromPages(
  pages: ScrapedContactPage[]
): Promise<string[]> {
  const usable = pages.filter((p) => p.ok && (p.text || p.mailtos.length));
  if (usable.length === 0) return [];

  let result: ExtractedEmails;
  try {
    result = await callOpenAIJson<ExtractedEmails>({
      model: env.OPENAI_FILTER_MODEL,
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(usable),
      jsonSchema: SCHEMA as unknown as Record<string, unknown>,
    });
  } catch (e) {
    await logEvent("warn", "LLM email extractor failed", {
      pageCount: usable.length,
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }

  const out: string[] = [];
  const seen = new Set<string>();
  const push = (email: string | null | undefined) => {
    if (!email || typeof email !== "string") return;
    const cleaned = email.trim().toLowerCase();
    if (!cleaned || !cleaned.includes("@")) return;
    if (seen.has(cleaned)) return;
    seen.add(cleaned);
    out.push(cleaned);
  };
  push(result.primary);
  if (Array.isArray(result.alternates)) {
    for (const a of result.alternates) push(a);
  }
  return out;
}
