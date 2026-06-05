import { env } from "@/lib/env";
import { assertAllowedUrl } from "@/lib/scrapers/base";
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
    signal: AbortSignal.timeout(12_000),
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

export async function discoverContactsForPosting(posting: {
  description: string;
  url: string;
  company: string;
}): Promise<DiscoveredContact[]> {
  // 1. Easiest: the posting body sometimes lists a hiring email directly.
  const fromBody = discoverFromBody(posting.description);
  if (fromBody.length > 0) return fromBody;

  const accumulated: DiscoveredContact[] = [];

  // 2. Try the posting URL's company website (if not a job board).
  const companyDomain = extractCompanyDomain(posting.url);
  if (companyDomain) {
    const fromSite = await discoverFromCompanySite(`https://${companyDomain}`);
    accumulated.push(...fromSite);
  }

  // 3. Look up the company's actual website via search, then scrape it.
  if (accumulated.length === 0 && posting.company) {
    const homepage = await findCompanyHomepage(posting.company);
    if (homepage) {
      const fromHomepage = await discoverFromCompanySite(homepage);
      accumulated.push(...fromHomepage);
    }
  }

  // 4. Last resort: search result snippets directly.
  if (accumulated.length === 0 && posting.company) {
    const fromSearch = await discoverViaSearch(posting.company);
    accumulated.push(...fromSearch);
  }

  // 5. Pattern-guess fallback (opt-in via env).
  if (accumulated.length === 0 && companyDomain) {
    accumulated.push(...discoverByPatternGuess(posting.url));
  }

  return accumulated;
}

export function extractCompanyUrlFromDescription(description: string): string | null {
  const urlMatch = description.match(/https?:\/\/[^\s<>"']+/);
  return urlMatch?.[0] ?? null;
}
