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

const SYSTEM_PROMPT = `You choose official company contact-page URLs from search results.

Rules:
- Return only URLs from the provided candidates.
- Prefer the company's official contact/contact-us page.
- Reject wrong-company lookalikes, job boards, ATS pages, directories, and unrelated companies.
- If only a homepage is credible, include it after contact-like pages.
- Return at most three URLs.`;

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
      model: env.OPENAI_FILTER_MODEL,
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
  if (path.includes("about")) score += 20;
  if (path === "/" || path === "") score += 5;
  if (hostname.startsWith("jobs.")) score -= 35;
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
