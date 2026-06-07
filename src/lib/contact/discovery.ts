import { env } from "@/lib/env";
import { callGrokJson, isGrokConfigured } from "@/lib/llm/grok";
import { assertAllowedUrl } from "@/lib/scrapers/base";
import { logEvent } from "@/lib/agent/observability";
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

interface GrokUrlResult {
  /** Primary site URL Grok found for the company. */
  url: string | null;
  /** Optional contact page URL on the same site. */
  contact_url?: string | null;
}

const GROK_SYSTEM_PROMPT = `You are GROK`;

/**
 * Ask Grok to find the company's website / contact URL, then scrape that
 * page (and a few contact-style variants) for emails. We no longer ask
 * Grok for the email directly — Grok is only used for URL discovery,
 * and the email is harvested by fetching the page and regex-matching.
 */
export async function discoverViaGrok(
  company: string,
  posting?: { title?: string; url?: string }
): Promise<DiscoveredContact[]> {
  if (!isGrokConfigured()) return [];
  if (!company || company.trim().length < 2) return [];

  void posting;
  const userPrompt =
    `search the official website URL for the company called ${company}\n\n` +
    `Return JSON: { "url": "<https URL of the company homepage or null>", "contact_url": "<https URL of the contact page or null>" }`;

  let result: Awaited<ReturnType<typeof callGrokJson<GrokUrlResult>>>;
  try {
    result = await callGrokJson<GrokUrlResult>({
      system: GROK_SYSTEM_PROMPT,
      user: userPrompt,
      searchMode: "on",
      maxSearchResults: 6,
      sources: [{ type: "web" }],
      timeoutMs: 30_000,
    });
  } catch (e) {
    await logEvent("warn", "Grok single-company HTTP error", {
      company,
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }

  const candidateUrls = collectCandidateUrls(
    [result.data?.url ?? null, result.data?.contact_url ?? null],
    result.raw,
    result.citations
  );
  if (candidateUrls.length === 0) return [];

  const emails = await scrapeEmailsFromUrls(candidateUrls);
  return scoreGrokEmails(emails);
}

interface GrokBatchEntry {
  /** Echo of the input company name so we can match results back. */
  company: string;
  url: string | null;
  contact_url?: string | null;
}

interface GrokBatchResult {
  results: GrokBatchEntry[];
}

const GROK_BATCH_SYSTEM_PROMPT = `You are GROK`;

/**
 * Bulk Grok URL lookup: ask Grok to find the official website (and contact
 * page if any) for each company in a single request. For each URL, fetch
 * the page and a few standard contact paths, regex-extract emails, and
 * return the per-company contact list.
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

  const queries = deduped
    .map((e) => `search the company URL for ${e.company}`)
    .join("\n");
  const userPrompt =
    `${queries}\n\n` +
    `Return JSON: { "results": [{ "company", "url", "contact_url" }] }`;

  let res: Awaited<ReturnType<typeof callGrokJson<GrokBatchResult>>>;
  try {
    res = await callGrokJson<GrokBatchResult>({
      system: GROK_BATCH_SYSTEM_PROMPT,
      user: userPrompt,
      searchMode: "on",
      maxSearchResults: Math.min(12, deduped.length * 3),
      sources: [{ type: "web" }],
      timeoutMs: 22_000,
    });
  } catch (e) {
    await logEvent("warn", "Grok batch HTTP error", {
      batchSize: deduped.length,
      error: e instanceof Error ? e.message : String(e),
    });
    return out;
  }

  // Build a per-company list of URLs to scrape: prefer Grok's structured
  // payload, then fall back to any URLs cited in the raw response for
  // companies the payload missed.
  const urlsByCompany = new Map<string, string[]>();
  const payload = tryParseGrokBatch(res.raw, res.data);
  const keys = Array.from(byCompany.keys());

  if (payload && Array.isArray(payload.results)) {
    for (const entry of payload.results) {
      const rawKey = entry.company?.trim().toLowerCase() ?? "";
      let inputKey: string | undefined;
      if (rawKey && byCompany.has(rawKey)) {
        inputKey = rawKey;
      } else {
        for (const key of keys) {
          if (rawKey && (key.includes(rawKey) || rawKey.includes(key))) {
            inputKey = key;
            break;
          }
        }
      }
      if (!inputKey) continue;
      const list = urlsByCompany.get(inputKey) ?? [];
      for (const u of [entry.contact_url, entry.url]) {
        if (typeof u === "string" && u.startsWith("http")) list.push(u);
      }
      urlsByCompany.set(inputKey, list);
    }
  }

  // Fall back to citations / bare URLs in the raw text for companies the
  // structured payload didn't cover. Assign each citation to the company
  // whose lowercase name appears in the URL.
  for (const url of [...res.citations, ...extractUrlsFromText(res.raw)]) {
    if (!url.startsWith("http")) continue;
    const lowerUrl = url.toLowerCase();
    for (const key of keys) {
      const compact = key.replace(/[^a-z0-9]/g, "");
      if (!compact) continue;
      if (lowerUrl.includes(compact)) {
        const list = urlsByCompany.get(key) ?? [];
        if (!list.includes(url)) list.push(url);
        urlsByCompany.set(key, list);
        break;
      }
    }
  }

  // Scrape each company's URLs for emails.
  let matched = 0;
  for (const [inputKey, urls] of Array.from(urlsByCompany.entries())) {
    if (urls.length === 0) continue;
    const emails = await scrapeEmailsFromUrls(urls);
    const contacts = scoreGrokEmails(emails);
    if (contacts.length === 0) continue;
    const inputCompany = byCompany.get(inputKey)!.company;
    out.set(inputCompany, contacts);
    matched++;
  }

  await logEvent("info", "Grok batch parsed", {
    requested: deduped.length,
    matched,
    hadStructuredPayload: !!payload?.results?.length,
    citations: res.citations.length,
  });

  return out;
}

function collectCandidateUrls(
  primary: Array<string | null>,
  raw: string,
  citations: string[]
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (u: string | null | undefined) => {
    if (!u || typeof u !== "string") return;
    if (!u.startsWith("http")) return;
    if (seen.has(u)) return;
    seen.add(u);
    out.push(u);
  };
  for (const u of primary) push(u);
  for (const u of citations) push(u);
  for (const u of extractUrlsFromText(raw)) push(u);
  return out;
}

function extractUrlsFromText(text: string): string[] {
  if (!text) return [];
  return text.match(/https?:\/\/[^\s"'<>)]+/g) ?? [];
}

/**
 * Per the user's spec: take the URL Grok returned, hit that page and the
 * same origin's `/contact` variant, regex-extract emails. No deep crawl
 * — that path used to fan out to 80+ requests per company and 504 the
 * Vercel function. Stops on the first usable email.
 */
async function scrapeEmailsFromUrls(urls: string[]): Promise<string[]> {
  const ordered: string[] = [];
  const seenEmails = new Set<string>();
  const seenUrls = new Set<string>();

  // Only the URL itself + same-origin `/contact` and `/contact-us`. Anything
  // more makes the worst-case wall-time blow past the 60 s Vercel ceiling.
  const candidates: string[] = [];
  for (const url of urls.slice(0, 3)) {
    try {
      assertAllowedUrl(url);
    } catch {
      continue;
    }
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      continue;
    }
    for (const candidate of [url, `${origin}/contact`, `${origin}/contact-us`]) {
      if (seenUrls.has(candidate)) continue;
      seenUrls.add(candidate);
      candidates.push(candidate);
    }
  }

  for (const candidate of candidates) {
    try {
      const html = await defaultFetch(candidate);
      for (const email of extractEmailsFromText(html)) {
        if (seenEmails.has(email)) continue;
        seenEmails.add(email);
        ordered.push(email);
      }
      if (ordered.length >= 2) break;
    } catch {
      continue;
    }
  }
  return ordered;
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

function tryParseGrokBatch(
  raw: string,
  parsed: GrokBatchResult | null
): GrokBatchResult | null {
  if (parsed && Array.isArray(parsed.results)) return parsed;
  // Some Grok responses arrive with leading prose or a ```json fence. Strip
  // a fenced block if present and try to JSON-parse the longest balanced
  // {...} substring.
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(candidate.slice(start, end + 1)) as GrokBatchResult;
    if (obj && Array.isArray(obj.results)) return obj;
  } catch {
    /* swallow */
  }
  return null;
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
