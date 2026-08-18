import { callGeminiJson } from "@/lib/llm/client";
import { env } from "@/lib/env";
import { logEvent } from "@/lib/agent/observability";
import type { LangSearchUrlResult } from "@/lib/langsearch/client";

interface UrlFilterResult {
  /** The single URL the LLM picked as the contact page. */
  url: string | null;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    url: { type: ["string", "null"] },
  },
  required: ["url"],
} as const;

/**
 * Tight prompt: the LLM only gets candidates that already mention
 * "contact" or "apply" in their URL/title/snippet/summary. Its job is
 * just to pick the best of those — not to discover URLs from scratch.
 * This kills the hallucination cases (the model previously returned
 * gibberish URLs when given too much freedom).
 */
const SYSTEM_PROMPT = `You pick the ONE best URL for finding a company's \
contact email. The candidates have already been narrowed down to URLs \
that mention "contact" or "apply" somewhere in their title, snippet, or \
URL path.

Rules:
- Return ONE url, picked verbatim from the candidates list. Do NOT \
invent, edit, or paraphrase a URL.
- Strongly prefer paths ending in /contact, /contact-us, /apply, \
/careers, /jobs, /about, /team, /support.
- Prefer the company's own domain over third-party listings.
- Reject obvious wrong-company matches (the URL is for a different \
business than the one searched).
- If none of the candidates plausibly belong to the company being \
searched, return null.`;

/** Keywords that mean a candidate is worth showing to the LLM at all. */
const CONTACT_KEYWORDS = [
  "contact",
  "apply",
  "career",
  "careers",
  "hiring",
  "recruit",
  "/jobs",
  "team",
  "about",
];

const BLOCKED_HOST_PARTS = [
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "workable.com",
];

/**
 * Three-step pipeline:
 *   1. Deterministic pre-filter on "contact" / "apply" keywords. Anything
 *      that doesn't mention these gets dropped before the LLM ever sees it
 *      — prevents the model from hallucinating gibberish URLs because
 *      every option in its context is already plausible.
 *   2. LLM picks the single best URL from the curated list.
 *   3. We validate the LLM's pick against the allowed-set (verbatim
 *      match) so a hallucinated URL is rejected even if it slips through.
 * Fallback to deterministic scoring when the LLM can't pick or returns
 * something invalid.
 */
export async function filterContactUrls(
  company: string,
  candidates: LangSearchUrlResult[]
): Promise<string[]> {
  if (candidates.length === 0) return [];

  const allowed = uniqueCandidateUrls(candidates);
  if (allowed.length === 0) return [];
  const allowedSet = new Set(allowed);

  // Step 1: keyword pre-filter. Pull the candidates whose URL, title,
  // snippet, or summary actually mentions a contact-style keyword.
  const keywordHits = candidates.filter((candidate) =>
    candidateMentionsContactKeyword(candidate)
  );

  // No candidate even mentions "contact"/"apply"/etc. Don't waste an LLM
  // call on a list it'll likely hallucinate from — fall straight through
  // to deterministic scoring.
  if (keywordHits.length === 0) {
    return fallbackContactUrls(company, candidates);
  }

  // Step 2: LLM picks one URL from the curated list. We send only the
  // sentences that contain the keyword indicators so the model can't
  // wander off into URLs we don't trust.
  try {
    const result = await callGeminiJson<UrlFilterResult>({
      model: env.GEMINI_MODEL,
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(company, keywordHits),
      jsonSchema: SCHEMA as unknown as Record<string, unknown>,
    });
    const picked =
      typeof result.url === "string" ? normalizeUrl(result.url) : null;
    // Step 3: hard-validate against the allowed set. A hallucinated URL
    // never reaches the scraper.
    if (picked && allowedSet.has(picked)) {
      return [picked];
    }
    if (picked) {
      await logEvent("warn", "LLM URL filter returned out-of-set URL", {
        company,
        picked,
        candidateCount: keywordHits.length,
      });
    }
  } catch (e) {
    await logEvent("warn", "LLM URL filter failed", {
      company,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Deterministic fallback — score the keyword-hit candidates ourselves.
  // Note we score the FILTERED list, not the original, so we never
  // surface a URL the LLM was also denied.
  return fallbackContactUrls(company, keywordHits);
}

/** Does this candidate mention a contact / apply / careers keyword anywhere? */
function candidateMentionsContactKeyword(
  candidate: LangSearchUrlResult
): boolean {
  const haystack = [
    candidate.url,
    candidate.displayUrl,
    candidate.title,
    candidate.snippet,
    candidate.summary,
  ]
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .toLowerCase();
  return CONTACT_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

/**
 * Pull only the sentences from snippet/summary that actually mention a
 * contact keyword. Keeps the LLM prompt small and on-topic.
 */
function relevantSentences(candidate: LangSearchUrlResult): string[] {
  const blob = [candidate.snippet, candidate.summary]
    .filter((part): part is string => typeof part === "string")
    .join(" ");
  if (!blob) return [];
  // Split on common boundaries (newline, period, semicolon, |, ·) so each
  // sentence-ish chunk is independent.
  const chunks = blob
    .split(/[\n.;|·]+/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
  const matches = chunks.filter((chunk) => {
    const lower = chunk.toLowerCase();
    return CONTACT_KEYWORDS.some((keyword) => lower.includes(keyword));
  });
  return matches.slice(0, 4).map((s) => (s.length > 320 ? s.slice(0, 320) : s));
}

export function fallbackContactUrls(
  company: string,
  candidates: LangSearchUrlResult[]
): string[] {
  return candidates
    .filter((candidate) => isUsableHttpUrl(candidate.url))
    .map((candidate, index) => ({
      url: normalizeUrl(candidate.url)!,
      score: scoreCandidate(company, candidate),
      index,
    }))
    .filter((candidate) => candidate.score > -20)
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .map((candidate) => candidate.url)
    .filter((url, index, all) => all.indexOf(url) === index)
    .slice(0, 3);
}

function buildUserPrompt(
  company: string,
  candidates: LangSearchUrlResult[]
): string {
  return [
    `Company: ${company}`,
    "Candidates (every entry already mentions a contact-style keyword):",
    ...candidates.slice(0, 8).map((candidate, i) => {
      const sentences = relevantSentences(candidate);
      const lines = [
        `${i + 1}. ${candidate.title}`,
        `URL: ${candidate.url}`,
        `Display URL: ${candidate.displayUrl}`,
      ];
      if (sentences.length > 0) {
        lines.push("Matched sentences:");
        for (const sentence of sentences) {
          lines.push(`  - ${sentence}`);
        }
      }
      return lines.join("\n");
    }),
    "",
    "Return JSON: { url: <best candidate URL or null> }",
  ].join("\n\n");
}

function uniqueCandidateUrls(candidates: LangSearchUrlResult[]): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeUrl(candidate.url);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
  }
  return urls;
}

function isUsableHttpUrl(raw: string): boolean {
  const normalized = normalizeUrl(raw);
  if (!normalized) return false;
  const hostname = new URL(normalized).hostname.toLowerCase();
  return !BLOCKED_HOST_PARTS.some((blocked) => hostname.includes(blocked));
}

function normalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function scoreCandidate(
  company: string,
  candidate: LangSearchUrlResult
): number {
  const normalized = normalizeUrl(candidate.url);
  if (!normalized) return -100;
  const url = new URL(normalized);
  const hostname = url.hostname.replace(/^www\./, "").toLowerCase();
  const path = url.pathname.toLowerCase();
  const haystack = [
    candidate.title,
    candidate.displayUrl,
    candidate.snippet,
    candidate.summary,
    hostname,
    path,
  ].join(" ").toLowerCase();

  let score = 0;
  if (path.includes("contact")) score += 80;
  if (path.includes("apply")) score += 70;
  if (path.includes("careers") || path.includes("career")) score += 50;
  if (path.includes("/jobs") || path.endsWith("/jobs")) score += 40;
  if (path.includes("about")) score += 20;
  if (path.includes("team") || path.includes("support")) score += 15;
  if (path === "/" || path === "") score += 5;
  if (hostname.startsWith("jobs.")) score -= 10;
  if (BLOCKED_HOST_PARTS.some((blocked) => hostname.includes(blocked))) {
    score -= 100;
  }

  const tokens = company
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !["ltd", "llc", "inc"].includes(token));
  for (const token of tokens) {
    if (hostname.includes(token)) score += 25;
    else if (haystack.includes(token)) score += 8;
    else score -= 8;
  }

  if (haystack.includes("contact us")) score += 15;
  if (haystack.includes("email")) score += 8;
  return score;
}
