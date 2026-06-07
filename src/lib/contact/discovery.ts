import { env } from "@/lib/env";
import { callGrokJson, isGrokConfigured } from "@/lib/llm/grok";
import { assertAllowedUrl } from "@/lib/scrapers/base";
import { logEvent } from "@/lib/agent/observability";
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

// Don't surface emails that point back at the job-board itself; they belong
// to the board, not the employer.
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

// Generic noise that's almost never a real employer contact.
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

export function isUsefulEmail(email: string): boolean {
  const lower = email.toLowerCase();
  const [local, domain] = lower.split("@");
  if (!local || !domain) return false;
  if (EMAIL_BLOCKLIST_LOCAL.has(local)) return false;
  if (EMAIL_BLOCKLIST_DOMAIN.some((d) => domain === d || domain.endsWith("." + d))) {
    return false;
  }
  // Drop image-style "u003e" or huge tokens that came out of garbage HTML.
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

  // Always try the homepage first — most companies put contact info in the footer.
  const candidates = ["/", ...COMPANY_PATHS];
  for (const path of candidates) {
    try {
      const html = await fetchFn(`${origin}${path}`);
      const emails = extractEmailsFromText(html);
      for (const email of emails) {
        if (seen.has(email)) continue;
        seen.add(email);
        collected.push({
          email,
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

/**
 * Confidence ranking: role-based addresses (careers@, hr@, hiring@) are
 * better cold-outreach targets than personal emails like dave@. Higher is
 * better; capped at 0.85 so listed-in-body emails (0.9) still win.
 */
function rankByPrefix(email: string): number {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  const high = ["careers", "hiring", "jobs", "hr", "people", "recruiting", "talent"];
  const mid = ["contact", "hello", "info", "support", "team", "office"];
  if (high.includes(local)) return 0.85;
  if (mid.includes(local)) return 0.7;
  return 0.55;
}

/**
 * Search the open web for the company's contact email. We use DuckDuckGo's
 * HTML endpoint because it has no API key requirement and returns plain
 * HTML; that lets us extract candidate emails directly from result
 * snippets without paid services like Google CSE or Hunter.io.
 */
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
        // Slight confidence penalty vs. on-site scraping — search hits can
        // be third-party mentions.
        collected.push({
          email,
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

/**
 * Find a likely company homepage URL by searching the web for the company
 * name and returning the first non-job-board result.
 */
export async function findCompanyHomepage(
  company: string,
  fetchFn: (url: string) => Promise<string> = defaultFetch
): Promise<string | null> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`${company} official website`)}`;
  try {
    const html = await fetchFn(url);
    // DuckDuckGo wraps result URLs in /l/?uddg=<encoded> — grab any http(s)
    // URL from the page and pick the first that isn't a job board or DDG link.
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
    /* swallow */
  }
  return null;
}

function decodeRedirect(url: string): string {
  // DDG wraps with /l/?uddg=<percent-encoded>
  const m = url.match(/[?&]uddg=([^&]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
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

const GROK_SYSTEM_PROMPT = "You are Grok.";

/**
 * Ask Grok specifically for the "Contact us" page URL of a company, then
 * hand the URL(s) to the Python DOM-scrape service, then let OpenAI pick
 * the right email from the rendered content. No more TS `fetch + regex`
 * scraping — the regex was missing JS-rendered addresses and the OpenAI
 * extractor handles obfuscated / "info [at] foo dot com" formats too.
 */
export async function discoverViaGrok(
  company: string,
  posting?: { title?: string; url?: string }
): Promise<DiscoveredContact[]> {
  if (!isGrokConfigured()) return [];
  const normalizedCompany = company.trim();
  if (!normalizedCompany || normalizedCompany.length < 2) return [];

  void posting;
  const userPrompt = `Search the contact us URL for this company: ${normalizedCompany}`;

  let result: Awaited<ReturnType<typeof callGrokJson<unknown>>>;
  try {
    result = await callGrokJson<unknown>({
      system: GROK_SYSTEM_PROMPT,
      user: userPrompt,
      timeoutMs: 25_000,
    });
  } catch (e) {
    await logEvent("warn", "Grok single-company HTTP error", {
      company,
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }

  // Contact URL wins over homepage — the LLM extractor sees the contact
  // page first and stops there if it's enough.
  const candidateUrls = collectCandidateUrls(result.raw, result.citations);
  if (candidateUrls.length === 0) return [];

  const emails = await scrapeAndExtract(candidateUrls);
  return scoreGrokEmails(emails);
}

/**
 * Compatibility wrapper for callers that still hand in a batch. Grok itself
 * is called once per company because the simple prompt matches the behavior
 * that works in the Grok web UI more reliably than multi-company JSON output.
 */
export async function discoverViaGrokBatch(
  inputs: Array<{ company: string; jobTitle?: string; jobUrl?: string }>
): Promise<Map<string, DiscoveredContact[]>> {
  const out = new Map<string, DiscoveredContact[]>();
  if (!isGrokConfigured()) return out;

  const byCompany = new Map<string, { company: string; jobTitle?: string; jobUrl?: string }>();
  for (const input of inputs) {
    const key = input.company?.trim();
    if (!key || key.length < 2) continue;
    if (!byCompany.has(key.toLowerCase())) {
      byCompany.set(key.toLowerCase(), input);
    }
  }
  const deduped = Array.from(byCompany.values());
  if (deduped.length === 0) return out;

  let matched = 0;
  for (const input of deduped) {
    const contacts = await discoverViaGrok(input.company, {
      title: input.jobTitle,
      url: input.jobUrl,
    });
    if (contacts.length === 0) continue;
    out.set(input.company, contacts);
    matched++;
  }

  await logEvent("info", "Grok batch compatibility processed", {
    requested: deduped.length,
    matched,
  });

  return out;
}

function collectCandidateUrls(raw: string, citations: string[]): string[] {
  const seen = new Map<string, number>();
  const push = (u: string | null | undefined) => {
    if (!u || typeof u !== "string") return;
    const normalized = normalizeCandidateUrl(u);
    if (!normalized || seen.has(normalized)) return;
    seen.set(normalized, seen.size);
  };
  for (const u of citations) push(u);
  for (const u of extractUrlsFromText(raw)) push(u);
  return Array.from(seen.entries())
    .sort(([a, aIndex], [b, bIndex]) => {
      const rank = rankCandidateUrl(a) - rankCandidateUrl(b);
      return rank === 0 ? aIndex - bIndex : rank;
    })
    .map(([url]) => url);
}

function extractUrlsFromText(text: string): string[] {
  if (!text) return [];
  return text.match(/https?:\/\/[^\s"'<>)\]]+/g) ?? [];
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

function rankCandidateUrl(url: string): number {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    if (path.includes("contact")) return 0;
    if (
      path.includes("support") ||
      path.includes("help") ||
      path.includes("about")
    ) {
      return 1;
    }
    if (path === "/" || path === "") return 3;
    return 2;
  } catch {
    return 4;
  }
}

/**
 * Take the URL(s) Grok produced for a single company, send them to the
 * Python `/api/py/scrape-contact` service (Playwright when available,
 * `requests + BeautifulSoup` fallback), then ask OpenAI to pick the best
 * outreach email out of the rendered DOM. This is the path the user
 * specified: Grok → URL → Python DOM scrape → OpenAI extraction.
 *
 * Returns an ordered list of emails (best first). Empty array on any
 * failure so the caller can fall through to mark-as-skipped.
 */
async function scrapeAndExtract(urls: string[]): Promise<string[]> {
  // Strip URLs pointing at blocked job-board / ATS domains; Grok sometimes
  // cites these as the "contact page" and they're never useful.
  const safe: string[] = [];
  const seen = new Set<string>();
  for (const url of urls.slice(0, 3)) {
    try {
      assertAllowedUrl(url);
    } catch {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    safe.push(url);
    // Always tee up the same-origin `/contact` page too — many companies
    // put their email there but Grok cites the homepage.
    try {
      const origin = new URL(url).origin;
      const contact = `${origin}/contact`;
      if (!seen.has(contact)) {
        seen.add(contact);
        safe.push(contact);
      }
    } catch {
      /* skip malformed URL */
    }
  }
  if (safe.length === 0) return [];

  let pages: ScrapedContactPage[];
  try {
    const result = await scrapeContactPages(safe);
    pages = result.results;
  } catch (e) {
    await logEvent("warn", "scrapeContactPages failed", {
      urlCount: safe.length,
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
  if (pages.length === 0) return [];

  // OpenAI does the final filter — picks the role-based contact, skips
  // noreply / footer noise, handles obfuscated "info [at] foo dot com".
  return extractEmailsFromPages(pages);
}

/**
 * Loose filter: drop ONLY obvious automation noise. We deliberately don't
 * reject job-board / ATS / tracker domains here — small studios sometimes
 * have their genuine mailbox hosted at a third party (e.g. a Wix-hosted
 * address), and rejecting them costs us more leads than we save in noise.
 */
function isAcceptableGrokEmail(email: string): boolean {
  const lower = email.toLowerCase();
  const local = lower.split("@")[0] ?? "";
  if (!local || !lower.includes("@")) return false;
  if (EMAIL_BLOCKLIST_LOCAL.has(local)) return false;
  if (local.length > 64) return false;
  return true;
}

function scoreGrokEmails(ordered: string[]): DiscoveredContact[] {
  const contacts: DiscoveredContact[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < ordered.length; i++) {
    const email = ordered[i].toLowerCase().trim();
    if (seen.has(email)) continue;
    if (!isAcceptableGrokEmail(email)) continue;
    seen.add(email);
    const baseConf = i === 0 ? 0.9 : 0.72 - i * 0.04;
    contacts.push({
      email,
      sourceType: "scraped_from_site",
      confidence: Math.max(0.5, Math.min(0.95, baseConf)),
    });
  }
  return contacts;
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
    sourceType: "pattern_guessed" as const,
    // First prefix slightly higher confidence than the rest.
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
  return contacts.sort((a, b) => b.confidence - a.confidence)[0];
}

export async function discoverContactsForPosting(
  posting: {
    description: string;
    url: string;
    company: string;
  },
  options: { skipGrok?: boolean } = {}
): Promise<DiscoveredContact[]> {
  // 1. Easiest + cheapest: the posting body sometimes lists a hiring email.
  const fromBody = discoverFromBody(posting.description);
  if (fromBody.length > 0) return fromBody;

  const accumulated: DiscoveredContact[] = [];

  // 2. Ask Grok to find the right email via live web search. This is the
  //    most accurate path — Grok visits the company's real site, picks the
  //    role-based address, and cites the source page. Skipped when
  //    GROK_API_KEY isn't configured so the build stays fully optional.
  //    Also skipped when the caller has already run the bulk Grok pass.
  if (posting.company && isGrokConfigured() && !options.skipGrok) {
    const fromGrok = await discoverViaGrok(posting.company, {
      title: posting.description.slice(0, 120),
      url: posting.url,
    });
    accumulated.push(...fromGrok);
  }

  // 3. Try the posting URL's company website (if it isn't a job board).
  if (accumulated.length === 0) {
    const companyDomain = extractCompanyDomain(posting.url);
    if (companyDomain) {
      const fromSite = await discoverFromCompanySite(`https://${companyDomain}`);
      accumulated.push(...fromSite);
    }
  }

  // 4. DuckDuckGo lookup for the company's actual homepage + scrape it.
  if (accumulated.length === 0 && posting.company) {
    const homepage = await findCompanyHomepage(posting.company);
    if (homepage) {
      const fromHomepage = await discoverFromCompanySite(homepage);
      accumulated.push(...fromHomepage);
    }
  }

  // 5. DDG search-result snippets as a last open-web pass.
  if (accumulated.length === 0 && posting.company) {
    const fromSearch = await discoverViaSearch(posting.company);
    accumulated.push(...fromSearch);
  }

  // 6. Pattern-guess fallback (opt-in via env).
  if (accumulated.length === 0) {
    const companyDomain = extractCompanyDomain(posting.url);
    if (companyDomain) {
      accumulated.push(...discoverByPatternGuess(posting.url));
    }
  }

  return accumulated;
}

export function extractCompanyUrlFromDescription(description: string): string | null {
  const urlMatch = description.match(/https?:\/\/[^\s<>"']+/);
  return urlMatch?.[0] ?? null;
}
