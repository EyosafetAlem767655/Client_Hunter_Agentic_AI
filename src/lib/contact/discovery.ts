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

interface GrokContactResult {
  /** Primary outreach email Grok found for the company. */
  email: string | null;
  /** Optional secondary candidates. */
  alternates?: string[];
  /** Why Grok chose this email (URL of the page it scraped from). */
  source_url?: string | null;
  /** Free-form confidence rationale Grok produced. */
  reason?: string | null;
}

const GROK_SYSTEM_PROMPT = `You help a recruiting agency find a working contact email for a company. Use your web search.

- Find ANY plausible public email — careers, hiring, hr, support, sales, contact, hello, info, partnerships, or a personal address listed on the company's site. Anything that actually reaches the company is fine.
- Don't be picky about role-based vs personal addresses; just return what you find.
- Only avoid obvious automation noise (noreply@, postmaster@, abuse@, sentry.io, wixpress.com).
- If you genuinely can't find one after a couple of searches, return email: null. Don't invent.
- Return ONLY JSON: { "email": "<one email or null>", "alternates": [<other emails you saw>] }. No prose, no markdown.`;

/**
 * Use Grok's built-in web search to find the right outreach email for a
 * company. Falls back to no result rather than guessing.
 */
export async function discoverViaGrok(
  company: string,
  posting?: { title?: string; url?: string }
): Promise<DiscoveredContact[]> {
  if (!isGrokConfigured()) return [];
  if (!company || company.trim().length < 2) return [];

  const userPrompt = [
    `Find ANY working contact email for the company below. A generic info@ or hello@ is fine.`,
    ``,
    `Company: ${company}`,
    posting?.title ? `Job title (context): ${posting.title}` : null,
    posting?.url ? `Job posting URL (context): ${posting.url}` : null,
    ``,
    `Return JSON only: { "email": "<one email or null>", "alternates": [<other emails>] }`,
  ]
    .filter(Boolean)
    .join("\n");

  let result: Awaited<ReturnType<typeof callGrokJson<GrokContactResult>>>;
  try {
    result = await callGrokJson<GrokContactResult>({
      system: GROK_SYSTEM_PROMPT,
      user: userPrompt,
      searchMode: "on",
      maxSearchResults: 6,
      sources: [{ type: "web" }],
      // No strict schema — Grok refuses too often. Plain JSON object output.
      timeoutMs: 30_000,
    });
  } catch (e) {
    await logEvent("warn", "Grok single-company HTTP error", {
      company,
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }

  const payload = result.data;
  const ordered: string[] = [];
  if (payload) {
    if (payload.email) ordered.push(payload.email);
    if (Array.isArray(payload.alternates)) ordered.push(...payload.alternates);
  }
  // Last-resort: bare emails out of the raw text — Grok sometimes answers
  // in markdown despite the JSON-only instruction.
  if (ordered.length === 0 && result.raw) {
    const found = result.raw.match(
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
    );
    if (found) ordered.push(...found);
  }

  const collected: DiscoveredContact[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < ordered.length; i++) {
    const email = ordered[i].toLowerCase().trim();
    if (seen.has(email)) continue;
    if (!isAcceptableGrokEmail(email)) continue;
    seen.add(email);
    const baseConf = i === 0 ? 0.9 : 0.72 - i * 0.04;
    collected.push({
      email,
      sourceType: "scraped_from_site",
      confidence: Math.max(0.5, Math.min(0.95, baseConf)),
    });
  }
  return collected;
}

interface GrokBatchEntry {
  /** Echo of the input company name so we can match results back. */
  company: string;
  email: string | null;
  alternates?: string[];
  source_url?: string | null;
  reason?: string | null;
}

interface GrokBatchResult {
  results: GrokBatchEntry[];
}

const GROK_BATCH_SYSTEM_PROMPT = `You help a recruiting agency find a working contact email for each company in a short list.

- Use your web search to find ANY plausible public email for the company — careers, hiring, recruiting, hr, support, sales, contact, hello, info, press, partnerships, or even a personal address listed on the company's site. Anything that reaches the company is fine.
- Don't be picky. If you can see an email associated with the company on a credible-looking page, return it.
- Only avoid obvious noise: noreply@, postmaster@, abuse@, automated CRM/tracker domains like sentry.io or wixpress.com.
- If you truly cannot find any email after a couple of searches, return email: null for that entry — don't invent one.
- Echo the company name back exactly as it was given so we can match results.
- Return ONLY a JSON object of the shape { "results": [{ "company", "email", "alternates" }] }. No prose, no markdown.`;

/**
 * Bulk Grok lookup: ask Grok to find the right outreach email for up to ~5
 * companies in a single request. Cheaper than 5 separate calls and stays
 * within the Vercel Hobby 60 s function budget.
 */
export async function discoverViaGrokBatch(
  inputs: Array<{ company: string; jobTitle?: string; jobUrl?: string }>
): Promise<Map<string, DiscoveredContact[]>> {
  const out = new Map<string, DiscoveredContact[]>();
  if (!isGrokConfigured()) return out;

  // Dedupe by company name so we don't waste budget on duplicates.
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

  const lines = deduped.map(
    (e, i) =>
      `${i + 1}. ${e.company}` +
      (e.jobTitle ? ` (role: ${e.jobTitle})` : "") +
      (e.jobUrl ? ` (posting: ${e.jobUrl})` : "")
  );
  const userPrompt =
    `Find ANY working contact email for each company below. Even a generic info@ or hello@ is fine. Return JSON only.\n\n` +
    `Format: { "results": [{ "company": "<exactly as given>", "email": "<one email or null>", "alternates": [<other emails you saw>] }, ...] }\n\n` +
    `Companies:\n${lines.join("\n")}\n`;

  let res: Awaited<ReturnType<typeof callGrokJson<GrokBatchResult>>>;
  try {
    res = await callGrokJson<GrokBatchResult>({
      system: GROK_BATCH_SYSTEM_PROMPT,
      user: userPrompt,
      searchMode: "on",
      // Each company gets ~1-2 searches; cap the total to keep latency in check.
      maxSearchResults: Math.min(12, deduped.length * 3),
      sources: [{ type: "web" }],
      // Intentionally NO json_schema — the strict OpenAI-style schema makes
      // Grok refuse outright when its scraped data doesn't fit. We let the
      // model produce a plain JSON object instead, parse what we can, and
      // even extract bare emails from the raw text as a last resort.
      // 22 s per batch × concurrency 4 keeps the discovery phase under
      // ~30 s wall-time even when batches stall.
      timeoutMs: 22_000,
    });
  } catch (e) {
    await logEvent("warn", "Grok batch HTTP error", {
      batchSize: deduped.length,
      error: e instanceof Error ? e.message : String(e),
    });
    return out;
  }

  // Try the structured payload first.
  const payload = tryParseGrokBatch(res.raw, res.data);
  const matched = new Set<string>();

  if (payload && Array.isArray(payload.results)) {
    const keys = Array.from(byCompany.keys());
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

      const ordered = [entry.email, ...(entry.alternates ?? [])].filter(
        (e): e is string => typeof e === "string" && e.length > 0
      );

      const contacts = scoreGrokEmails(ordered);
      if (contacts.length > 0) {
        const inputCompany = byCompany.get(inputKey)!.company;
        out.set(inputCompany, contacts);
        matched.add(inputKey);
      }
    }
  }

  // Salvage pass: for any input company we couldn't satisfy from the
  // structured payload, scan the raw response for emails that mention the
  // company anywhere nearby. Grok sometimes writes "Acme — careers@acme.com"
  // in markdown despite our JSON-only instruction; don't waste it.
  if (matched.size < byCompany.size) {
    const harvested = harvestEmailsByCompany(res.raw, byCompany);
    for (const [inputKey, emails] of Array.from(harvested.entries())) {
      if (matched.has(inputKey)) continue;
      const contacts = scoreGrokEmails(emails);
      if (contacts.length === 0) continue;
      const inputCompany = byCompany.get(inputKey)!.company;
      out.set(inputCompany, contacts);
      matched.add(inputKey);
    }
  }

  await logEvent("info", "Grok batch parsed", {
    requested: deduped.length,
    matched: matched.size,
    hadStructuredPayload: !!payload?.results?.length,
  });

  return out;
}

/**
 * Loose filter: drop ONLY obvious automation noise. We deliberately don't
 * reject job-board / ATS / tracker domains here — Grok occasionally finds
 * the genuine employer mailbox hosted at a third party (e.g. a small
 * studio still using a Wix-hosted address), and rejecting them costs us
 * more leads than we save in noise.
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

/**
 * If JSON parsing fails entirely, walk the raw text and assign any emails
 * we find to the company name that appears nearest to them (within a 240-
 * char window). This is messy but recovers real leads when Grok decides
 * to answer in prose despite our instructions.
 */
function harvestEmailsByCompany(
  raw: string,
  byCompany: Map<string, { company: string }>
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!raw) return out;
  const lower = raw.toLowerCase();
  const companies = Array.from(byCompany.entries()); // [lowercaseKey, input]

  const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  let match: RegExpExecArray | null;
  while ((match = emailRe.exec(raw)) !== null) {
    const email = match[0].toLowerCase();
    const at = match.index;
    const windowStart = Math.max(0, at - 240);
    const windowEnd = Math.min(raw.length, at + 240);
    const ctx = lower.slice(windowStart, windowEnd);

    // Strong signal: if the email's local-part or domain contains the
    // company name, that's the right owner regardless of prose proximity.
    let bestKey: string | null = null;
    for (const [key] of companies) {
      const compact = key.replace(/[^a-z0-9]/g, "");
      if (!compact) continue;
      if (email.includes(compact)) {
        bestKey = key;
        break;
      }
    }

    // Fallback: pick the company whose name appears closest in the window.
    if (!bestKey) {
      let bestDist = Infinity;
      for (const [key] of companies) {
        const idx = ctx.indexOf(key);
        if (idx === -1) continue;
        const absIdx = windowStart + idx;
        const dist = Math.abs(absIdx - at);
        if (dist < bestDist) {
          bestDist = dist;
          bestKey = key;
        }
      }
    }

    if (!bestKey) continue;
    const list = out.get(bestKey) ?? [];
    if (!list.includes(email)) list.push(email);
    out.set(bestKey, list);
  }
  return out;
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
