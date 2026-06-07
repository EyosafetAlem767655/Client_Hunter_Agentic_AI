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

const SYSTEM_PROMPT = `You pick the best business contact email from a \
short, pre-filtered list of email-containing sentences scraped from a \
company's contact page. Each sentence already contains "@" — your job \
is to choose the right one, not to find them.

Rules:
- Prefer role-based addresses (careers@, jobs@, hiring@, hr@, \
recruiting@, hello@, contact@, info@) over personal addresses \
(john@, jane.smith@).
- Skip noreply / no-reply / postmaster / abuse / privacy@ — those don't \
read incoming mail.
- Skip emails on ATS / tracker / analytics domains (sentry.io, \
googleapis.com, github.com, gravatar.com, wix.com, etc.) — they aren't \
the company's mailbox.
- If the page lists multiple departments, the recruiting / HR address \
wins.
- If you can't find any usable email, return primary: null.
- Return ONLY emails that appeared verbatim in the supplied snippets. \
Do NOT invent.`;

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

const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const EMAIL_REGEX_GLOBAL = new RegExp(EMAIL_REGEX.source, "g");

interface PageSnippets {
  url: string;
  engine: ScrapedContactPage["engine"];
  /** All emails extracted by regex, before the LLM filter. */
  rawEmails: string[];
  /** Sentence-sized chunks that contained "@". */
  snippets: string[];
  /** mailto: hrefs found on the page. */
  mailtos: string[];
}

/**
 * Pull all sentence-sized chunks that contain "@" from a scraped page.
 * This is the deterministic pre-filter the user asked for: send ONLY
 * @-containing context to the LLM so it can't get distracted by
 * navigation / hero copy / cookie banners / footer noise.
 */
export function collectEmailSnippets(page: ScrapedContactPage): PageSnippets {
  const rawEmails = new Set<string>();
  const snippets: string[] = [];
  const seenSnippets = new Set<string>();

  // Pull addresses from mailtos first — those are the cleanest source.
  for (const mailto of page.mailtos ?? []) {
    const match = mailto.match(EMAIL_REGEX);
    if (match) rawEmails.add(match[0].toLowerCase());
  }

  const pushSnippet = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed || !trimmed.includes("@")) return;
    const truncated = trimmed.length > 320 ? trimmed.slice(0, 320) : trimmed;
    if (seenSnippets.has(truncated)) return;
    seenSnippets.add(truncated);
    snippets.push(truncated);
    let emailMatch: RegExpExecArray | null;
    const regex = new RegExp(EMAIL_REGEX_GLOBAL.source, "g");
    while ((emailMatch = regex.exec(trimmed)) !== null) {
      rawEmails.add(emailMatch[0].toLowerCase());
    }
  };

  // Sentence-sized chunks from page text.
  const text = page.text ?? "";
  if (text.includes("@")) {
    const chunks = text.split(/[\n.;|·]+/);
    for (const chunk of chunks) {
      if (chunk.includes("@")) pushSnippet(chunk);
      if (snippets.length >= 60) break;
    }
  }

  // DOM elements whose text or attributes contain "@" — these often have
  // the email even when the page text has been concatenated awkwardly.
  for (const element of page.elements ?? []) {
    if (snippets.length >= 60) break;
    const elText = element.text ?? "";
    const attrs = element.attributes ?? {};
    const attrBlob = JSON.stringify(attrs);
    const hasEmailInElement =
      elText.includes("@") || attrBlob.includes("@");
    if (!hasEmailInElement) continue;
    if (elText.includes("@")) pushSnippet(elText);
    if (attrBlob.includes("@")) {
      // Show the relevant attribute key/value rather than the whole DOM
      // serialization — keeps the snippet short and parsable.
      for (const [key, value] of Object.entries(attrs)) {
        const valueStr = Array.isArray(value)
          ? value.join(" ")
          : typeof value === "string"
            ? value
            : "";
        if (valueStr.includes("@")) {
          pushSnippet(`${element.tag}[${key}]: ${valueStr}`);
        }
      }
    }
  }

  // Also add mailtos as snippets so they're explicitly visible to the LLM.
  for (const mailto of page.mailtos ?? []) {
    pushSnippet(`mailto: ${mailto}`);
    if (snippets.length >= 60) break;
  }

  return {
    url: page.url,
    engine: page.engine,
    rawEmails: Array.from(rawEmails),
    snippets,
    mailtos: page.mailtos ?? [],
  };
}

function buildUserPrompt(pageSnippets: PageSnippets[]): string {
  const blocks = pageSnippets.map((p, i) => {
    const snippetLines = p.snippets.length
      ? p.snippets.map((s) => `  - ${s}`).join("\n")
      : "  (none)";
    const rawList = p.rawEmails.length
      ? p.rawEmails.join(", ")
      : "(none extracted by regex)";
    return [
      `=== Page ${i + 1}: ${p.url} (engine: ${p.engine}) ===`,
      `Emails seen in source (regex pre-pass): ${rawList}`,
      "Sentences containing '@':",
      snippetLines,
    ].join("\n");
  });
  return [
    "Below are the sentences that contained '@' on the company's scraped contact page(s).",
    "Pick the single best business contact email and a few alternates.",
    "",
    ...blocks,
  ].join("\n\n");
}

/**
 * Send the scraped contact-page content to OpenAI and let the model pick
 * the right business contact email. Returns primary first, then the
 * model's alternates. Empty list on parse / API failure, OR when no page
 * contained an `@` indicator (skip the LLM entirely — the caller will
 * fall through to a `url_only` contact).
 *
 * The model receives ONLY the sentences that contained "@", not the
 * whole DOM dump. This (a) prevents the LLM from hallucinating an email
 * from unrelated text and (b) keeps the prompt small enough to run fast
 * even on long contact pages.
 */
export async function extractEmailsFromPages(
  pages: ScrapedContactPage[]
): Promise<string[]> {
  const usable = pages.filter((p) => p.ok && (p.text || p.mailtos.length));
  if (usable.length === 0) return [];

  const allSnippets = usable.map(collectEmailSnippets);
  const withEmails = allSnippets.filter(
    (s) => s.snippets.length > 0 || s.rawEmails.length > 0
  );

  // Short-circuit: no "@" anywhere → LLM can only invent → skip it.
  if (withEmails.length === 0) {
    await logEvent("info", "Email extractor skipped — no @ found", {
      pageCount: usable.length,
    });
    return [];
  }

  // Belt-and-braces: collect every regex-matched email so we have a
  // safety net if the LLM refuses or returns an invented address. We
  // intersect the LLM's picks against this set.
  const allowedEmails = new Set<string>();
  for (const page of withEmails) {
    for (const email of page.rawEmails) {
      allowedEmails.add(email.toLowerCase());
    }
  }

  let result: ExtractedEmails;
  try {
    result = await callOpenAIJson<ExtractedEmails>({
      model: env.OPENAI_EMAIL_EXTRACT_MODEL,
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(withEmails),
      jsonSchema: SCHEMA as unknown as Record<string, unknown>,
    });
  } catch (e) {
    await logEvent("warn", "LLM email extractor failed", {
      pageCount: withEmails.length,
      error: e instanceof Error ? e.message : String(e),
    });
    // Fallback: if the LLM call fails but we DO have regex-matched
    // emails, return those — losing them just because OpenAI was slow
    // would force a url_only fallback when we already know the address.
    return Array.from(allowedEmails);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  const push = (email: string | null | undefined) => {
    if (!email || typeof email !== "string") return;
    const cleaned = email.trim().toLowerCase();
    if (!cleaned || !cleaned.includes("@")) return;
    // Hard validation: only accept addresses we actually saw in the
    // scraped DOM. The LLM cannot invent a new one.
    if (!allowedEmails.has(cleaned)) return;
    if (seen.has(cleaned)) return;
    seen.add(cleaned);
    out.push(cleaned);
  };
  push(result.primary);
  if (Array.isArray(result.alternates)) {
    for (const a of result.alternates) push(a);
  }

  // If the LLM's picks didn't survive validation, fall back to the
  // regex set so we still return what was on the page.
  if (out.length === 0 && allowedEmails.size > 0) {
    return Array.from(allowedEmails);
  }
  return out;
}
