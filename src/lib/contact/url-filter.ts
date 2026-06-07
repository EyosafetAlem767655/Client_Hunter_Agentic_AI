import { callOpenAIJson } from "@/lib/llm/client";
import { env } from "@/lib/env";
import { logEvent } from "@/lib/agent/observability";
import type { LangSearchUrlResult } from "@/lib/langsearch/client";

interface UrlFilterResult {
  urls: string[];
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    urls: {
      type: "array",
      items: { type: "string" },
      maxItems: 3,
    },
  },
  required: ["urls"],
} as const;

const SYSTEM_PROMPT = `You are picking the URL(s) most likely to surface a \
contact email for a given company. Be liberal — when in doubt, KEEP a \
candidate rather than throw it away. You have freedom to use your own \
judgement.

Strong signals to keep a URL:
- The host is (or looks like) the company's own domain.
- The path ends with /contact, /contact-us, /contacts, /apply, /careers, \
/jobs, /about, /about-us, /team, /support, /press, or a similar contact / \
careers-style path.
- The page title or snippet mentions reaching out, hiring, careers, or \
emailing the company.

Reject only when a URL clearly belongs to a different company than the \
one being searched. Job boards, ATS pages, and directories should be a \
last resort but are still OK to return if nothing better exists.

Return only URLs that appeared verbatim in the candidates. Return up to \
three URLs, best first.`;

const BLOCKED_HOST_PARTS = [
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "workable.com",
];

export async function filterContactUrls(
  company: string,
  candidates: LangSearchUrlResult[]
): Promise<string[]> {
  const allowed = uniqueCandidateUrls(candidates);
  if (allowed.length === 0) return [];

  try {
    const result = await callOpenAIJson<UrlFilterResult>({
      model: env.OPENAI_URL_FILTER_MODEL,
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(company, candidates),
      jsonSchema: SCHEMA as unknown as Record<string, unknown>,
    });
    const allowedSet = new Set(allowed);
    const filtered = Array.isArray(result.urls)
      ? result.urls.filter((url) => allowedSet.has(url)).slice(0, 3)
      : [];
    if (filtered.length > 0) return filtered;
  } catch (e) {
    await logEvent("warn", "LLM URL filter failed", {
      company,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return fallbackContactUrls(company, candidates);
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
    "Candidates:",
    ...candidates.slice(0, 8).map((candidate, i) =>
      [
        `${i + 1}. ${candidate.title}`,
        `URL: ${candidate.url}`,
        `Display URL: ${candidate.displayUrl}`,
        `Snippet: ${candidate.snippet.slice(0, 500)}`,
        `Summary: ${candidate.summary.slice(0, 900)}`,
      ].join("\n")
    ),
    "",
    "Return JSON: { urls: [best candidate URLs] }",
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
  // `jobs.` subdomain on the company's own domain often hosts the ATS;
  // mildly downgrade but don't bury — sometimes it's the only page that
  // exposes a careers email.
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
