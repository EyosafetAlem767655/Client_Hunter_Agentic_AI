import { env } from "@/lib/env";
import { assertAllowedUrl } from "@/lib/scrapers/base";
import { logEvent } from "@/lib/agent/observability";
import { findContactUrls } from "@/lib/langsearch/client";
import { filterContactUrls } from "./url-filter";
import {
  scrapeContactPages,
  type ScrapedContactPage,
} from "./python-scraper";
import { extractEmailsFromPages } from "./llm-email-extractor";
import type { DiscoveredContact } from "@/types";

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const MAILTO_REGEX = /mailto:([^\s"'<>]+)/gi;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const JOB_BOARD_DOMAINS = [
  "remotive.com",
  "weworkremotely.com",
  "remoteok.com",
  "arbeitnow.com",
  "jobicy.com",
  "ycombinator.com",
  "news.ycombinator.com",
  "indeed.com",
  "linkedin.com",
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "workable.com",
  "workatastartup.com",
];

const EMAIL_BLOCKLIST_LOCAL = new Set([
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "postmaster",
  "abuse",
  "spam",
  "example",
  "test",
  "sentry",
]);

const EMAIL_BLOCKLIST_DOMAIN = [
  "sentry.io",
  "sentry-next.wixpress.com",
  "wixpress.com",
  "wix.com",
  "googleapis.com",
  "google.com",
  "github.com",
  "gravatar.com",
  "w3.org",
  "schema.org",
  "example.com",
  "example.org",
  "sentry.wixpress.com",
  ...JOB_BOARD_DOMAINS,
];

const COMPANY_PATHS = [
  "/contact",
  "/contact-us",
  "/contacts",
  "/about",
  "/about-us",
  "/team",
  "/careers",
  "/jobs",
  "/support",
  "/help",
  "/press",
  "/legal/privacy",
  "/privacy",
];

export function isUsefulEmail(email: string): boolean {
  const lower = email.toLowerCase();
  const [local, domain] = lower.split("@");
  if (!local || !domain) return false;
  if (EMAIL_BLOCKLIST_LOCAL.has(local)) return false;
  if (EMAIL_BLOCKLIST_DOMAIN.some((d) => domain === d || domain.endsWith("." + d))) {
    return false;
  }
  if (local.length > 64 || domain.length > 64) return false;
  return true;
}

export function extractEmailsFromText(text: string): string[] {
  const found = new Set<string>();
  let match: RegExpExecArray | null;

  const mailtoCopy = new RegExp(MAILTO_REGEX.source, MAILTO_REGEX.flags);
  while ((match = mailtoCopy.exec(text)) !== null) {
    found.add(match[1].toLowerCase());
  }

  const emailCopy = new RegExp(EMAIL_REGEX.source, EMAIL_REGEX.flags);
  while ((match = emailCopy.exec(text)) !== null) {
    found.add(match[0].toLowerCase());
  }

  return Array.from(found).filter(isUsefulEmail);
}

export function discoverFromBody(description: string): DiscoveredContact[] {
  return extractEmailsFromText(description).map((email) => ({
    email,
    contactUrl: null,
    sourceType: "listed" as const,
    confidence: 0.9,
  }));
}

function extractCompanyDomain(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    if (JOB_BOARD_DOMAINS.some((b) => hostname === b || hostname.endsWith("." + b))) {
      return null;
    }
    return hostname;
  } catch {
    return null;
  }
}

export async function discoverFromCompanySite(
  siteUrl: string,
  fetchFn: (url: string) => Promise<string> = defaultFetch
): Promise<DiscoveredContact[]> {
  let origin: string;
  try {
    assertAllowedUrl(siteUrl);
    origin = new URL(siteUrl).origin;
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const collected: DiscoveredContact[] = [];

  for (const path of ["/", ...COMPANY_PATHS]) {
    try {
      const url = `${origin}${path}`;
      const html = await fetchFn(url);
      const emails = extractEmailsFromText(html);
      for (const email of emails) {
        if (seen.has(email)) continue;
        seen.add(email);
        collected.push({
          email,
          contactUrl: url,
          sourceType: "scraped_from_site",
          confidence: rankByPrefix(email),
        });
      }
      if (collected.length >= 3) break;
    } catch {
      continue;
    }
  }

  return collected;
}

function rankByPrefix(email: string): number {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  const high = ["careers", "hiring", "jobs", "hr", "people", "recruiting", "talent"];
  const mid = ["contact", "hello", "info", "support", "team", "office"];
  if (high.includes(local)) return 0.85;
  if (mid.includes(local)) return 0.7;
  return 0.55;
}

export async function discoverViaSearch(
  company: string,
  fetchFn: (url: string) => Promise<string> = defaultFetch
): Promise<DiscoveredContact[]> {
  const seen = new Set<string>();
  const collected: DiscoveredContact[] = [];

  const queries = [
    `"${company}" contact email`,
    `${company} careers email`,
    `${company} hr OR hiring email`,
  ];

  for (const query of queries) {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    try {
      const html = await fetchFn(url);
      const emails = extractEmailsFromText(html);
      for (const email of emails) {
        if (seen.has(email)) continue;
        seen.add(email);
        collected.push({
          email,
          contactUrl: null,
          sourceType: "scraped_from_site",
          confidence: Math.max(0.5, rankByPrefix(email) - 0.1),
        });
      }
      if (collected.length >= 3) break;
    } catch {
      continue;
    }
  }

  return collected;
}

export async function findCompanyHomepage(
  company: string,
  fetchFn: (url: string) => Promise<string> = defaultFetch
): Promise<string | null> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`${company} official website`)}`;
  try {
    const html = await fetchFn(url);
    const urlMatches = html.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
    for (const raw of urlMatches) {
      const candidate = decodeRedirect(raw);
      const host = safeHost(candidate);
      if (!host) continue;
      if (host.endsWith("duckduckgo.com")) continue;
      if (JOB_BOARD_DOMAINS.some((b) => host === b || host.endsWith("." + b))) {
        continue;
      }
      return `https://${host}`;
    }
  } catch {
    // Search fallback is best effort only.
  }
  return null;
}

function decodeRedirect(url: string): string {
  const match = url.match(/[?&]uddg=([^&]+)/);
  if (match) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return url;
    }
  }
  return url;
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export async function discoverViaLangSearch(
  company: string,
  posting?: { title?: string; url?: string }
): Promise<DiscoveredContact[]> {
  const normalizedCompany = company.trim();
  if (!normalizedCompany || normalizedCompany.length < 2) {
    return [];
  }

  void posting;
  let candidateUrls: string[] = [];
  try {
    const results = await findContactUrls(normalizedCompany);
    candidateUrls = await filterContactUrls(normalizedCompany, results);
  } catch (e) {
    await logEvent("warn", "LangSearch URL discovery failed", {
      company: normalizedCompany,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  if (candidateUrls.length === 0) {
    return [];
  }

  const { emails, urls } = await scrapeAndExtract(candidateUrls);
  const sourceUrl = urls[0] ?? candidateUrls[0];
  const emailContacts = scoreLangSearchEmails(emails, sourceUrl);
  if (emailContacts.length > 0) return emailContacts;

  return [urlOnlyContact(sourceUrl, 0.4)];
}

async function scrapeAndExtract(
  urls: string[]
): Promise<{ emails: string[]; urls: string[]; pages: ScrapedContactPage[] }> {
  const safe = prepareScrapeUrls(urls);
  if (safe.length === 0) return { emails: [], urls: [], pages: [] };

  let pages: ScrapedContactPage[];
  try {
    const result = await scrapeContactPages(safe);
    pages = result.results;
  } catch (e) {
    await logEvent("warn", "scrapeContactPages failed", {
      urlCount: safe.length,
      error: e instanceof Error ? e.message : String(e),
    });
    return { emails: [], urls: safe, pages: [] };
  }

  if (pages.length === 0) return { emails: [], urls: safe, pages };
  const emails = await extractEmailsFromPages(pages);
  return { emails, urls: safe, pages };
}

function prepareScrapeUrls(urls: string[]): string[] {
  const safe: string[] = [];
  const seen = new Set<string>();

  for (const raw of urls.slice(0, 3)) {
    const url = normalizeCandidateUrl(raw);
    if (!url) continue;
    try {
      assertAllowedUrl(url);
    } catch {
      continue;
    }
    pushUrl(url);

    try {
      const parsed = new URL(url);
      if (!parsed.pathname.toLowerCase().includes("contact")) {
        pushUrl(`${parsed.origin}/contact`);
      }
    } catch {
      // Already normalized above.
    }
  }

  return safe;

  function pushUrl(url: string) {
    if (seen.has(url)) return;
    seen.add(url);
    safe.push(url);
  }
}

function normalizeCandidateUrl(raw: string): string | null {
  const cleaned = raw
    .trim()
    .replace(/&amp;/g, "&")
    .replace(/[.,;!?]+$/g, "");
  if (!cleaned.startsWith("http")) return null;
  try {
    const url = new URL(cleaned);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function scoreLangSearchEmails(
  ordered: string[],
  contactUrl: string | null
): DiscoveredContact[] {
  const contacts: DiscoveredContact[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < ordered.length; i++) {
    const email = ordered[i].toLowerCase().trim();
    if (seen.has(email)) continue;
    if (!isUsefulEmail(email)) continue;
    seen.add(email);

    const baseConf = i === 0 ? 0.92 : 0.74 - i * 0.04;
    contacts.push({
      email,
      contactUrl,
      sourceType: "langsearch_scraped",
      confidence: Math.max(0.5, Math.min(0.95, baseConf)),
    });
  }

  return contacts;
}

function urlOnlyContact(url: string, confidence: number): DiscoveredContact {
  return {
    email: null,
    contactUrl: url,
    sourceType: "url_only",
    confidence,
  };
}

export function discoverByPatternGuess(
  companyUrl: string
): DiscoveredContact[] {
  if (!env.ENABLE_PATTERN_GUESSING) return [];
  const domain = extractCompanyDomain(companyUrl);
  if (!domain) return [];

  const prefixes = ["careers@", "jobs@", "hiring@", "hr@", "hello@", "contact@"];
  return prefixes.map((prefix, i) => ({
    email: `${prefix}${domain}`,
    contactUrl: companyUrl,
    sourceType: "pattern_guessed" as const,
    confidence: Math.max(0.25, 0.4 - i * 0.03),
  }));
}

async function defaultFetch(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(6_000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export function pickBestContact(
  contacts: DiscoveredContact[]
): DiscoveredContact | null {
  if (contacts.length === 0) return null;
  return [...contacts].sort((a, b) => b.confidence - a.confidence)[0];
}

export async function discoverContactsForPosting(
  posting: {
    description: string;
    url: string;
    company: string;
  },
  options: { skipLangSearch?: boolean } = {}
): Promise<DiscoveredContact[]> {
  const fromBody = discoverFromBody(posting.description);
  if (fromBody.length > 0) return fromBody;

  if (!options.skipLangSearch && posting.company) {
    const fromLangSearch = await discoverViaLangSearch(posting.company, {
      title: posting.description.slice(0, 120),
      url: posting.url,
    });
    if (fromLangSearch.length > 0) return fromLangSearch;
  }

  return [];
}

export function extractCompanyUrlFromDescription(description: string): string | null {
  const urlMatch = description.match(/https?:\/\/[^\s<>"']+/);
  return urlMatch?.[0] ?? null;
}
