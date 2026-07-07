import { env } from "@/lib/env";
import { parseLangSearchWebResults } from "@/lib/langsearch/client";
import { callClaudeText } from "@/lib/anthropic/client";

// Faithful TypeScript port of the user's verified
// langsearch_claude_to_clay.py flow:
//   name -> LangSearch -> drop aggregators + dedupe domains -> browse each ->
//   Claude picks the primary official domain -> POST to the Clay webhook.

const LANGSEARCH_URL = "https://api.langsearch.com/v1/web-search";
const MAX_BROWSE = 6;
const BROWSE_TIMEOUT_MS = 8_000;
const UA = "Mozilla/5.0 (compatible; lead-tool/1.0)";

const AGGREGATORS: string[] = [
  "linkedin.com", "crunchbase.com", "pitchbook.com", "leadiq.com",
  "zoominfo.com", "bloomberg.com", "facebook.com", "twitter.com", "x.com",
  "wikipedia.org", "glassdoor.com", "indeed.com", "youtube.com",
  "instagram.com", "apollo.io", "rocketreach.co", "dnb.com", "owler.com",
  "g2.com", "capterra.com", "trustpilot.com", "medium.com", "github.com",
  "apps.apple.com", "play.google.com", "reddit.com", "yelp.com",
  "himalayas.app", "remoteyeah.com", "wellfound.com", "builtin.com",
];

export interface BrowseInfo {
  domain: string;
  status: number | null;
  final_url: string;
  title: string;
  description: string;
  canonical: string;
  error?: string;
}

function host(netloc: string): string {
  const h = netloc.toLowerCase().split(":")[0];
  return h.startsWith("www.") ? h.slice(4) : h;
}

/** Last two labels: 'www.quickteam.com' -> 'quickteam.com'. */
function registrable(h: string): string {
  const parts = h.split(".");
  return parts.length >= 2 ? parts.slice(-2).join(".") : h;
}

function isAggregator(reg: string): boolean {
  return AGGREGATORS.some((a) => reg === a || reg.endsWith("." + a));
}

/** From LangSearch results -> unique, non-aggregator registrable domains (order preserved). */
export function toUniqueDomains(
  candidates: Array<{ url: string }>,
  max = MAX_BROWSE
): string[] {
  const domains: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    let netloc = "";
    try {
      netloc = new URL(c.url).host;
    } catch {
      continue;
    }
    const h = host(netloc);
    if (!h) continue;
    const reg = registrable(h);
    if (isAggregator(reg) || seen.has(reg)) continue;
    seen.add(reg);
    domains.push(reg);
  }
  return domains.slice(0, max);
}

/** Extract title / meta description / canonical from raw HTML. */
export function parseBrowseHtml(html: string): {
  title: string;
  description: string;
  canonical: string;
} {
  const clip = html.slice(0, 200_000);
  const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

  const t = clip.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const d = clip.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["']/i
  );
  const c = clip.match(
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([\s\S]*?)["']/i
  );

  return {
    title: t ? collapse(t[1]).slice(0, 200) : "",
    description: d ? collapse(d[1]).slice(0, 300) : "",
    canonical: c ? c[1].trim().slice(0, 200) : "",
  };
}

/** Parse Claude's "DOMAIN: x" answer. Returns null for NONE / missing. */
export function parseDomainAnswer(text: string): string | null {
  const m = text.match(/DOMAIN:\s*(\S+)/);
  let ans = (m ? m[1] : "").trim().toLowerCase();
  if (!ans || ans === "none") return null;
  ans = ans
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
  return ans || null;
}

async function langsearchWebsites(
  company: string
): Promise<Array<{ url: string; title: string }>> {
  const apiKey = env.LANGSEARCH_API_KEY?.trim();
  if (!apiKey) return [];

  const body = JSON.stringify({
    query: `${company} official company website`,
    freshness: "noLimit",
    summary: true,
    count: 8,
  });

  const call = (auth: string) =>
    fetch(LANGSEARCH_URL, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(20_000),
    });

  // The user's code uses `Bearer <key>`; the app's proven client uses the raw
  // key. Try Bearer first, fall back to raw on 401.
  let res = await call(`Bearer ${apiKey}`);
  if (res.status === 401) res = await call(apiKey);
  if (!res.ok) return [];

  return parseLangSearchWebResults(await res.json()).map((r) => ({
    url: r.url,
    title: r.title,
  }));
}

export async function browseDomain(domain: string): Promise<BrowseInfo> {
  const info: BrowseInfo = {
    domain,
    status: null,
    final_url: "",
    title: "",
    description: "",
    canonical: "",
  };
  try {
    const res = await fetch("https://" + domain, {
      redirect: "follow",
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(BROWSE_TIMEOUT_MS),
    });
    info.status = res.status;
    info.final_url = res.url;
    const parsed = parseBrowseHtml(await res.text());
    info.title = parsed.title;
    info.description = parsed.description;
    info.canonical = parsed.canonical;
  } catch (e) {
    info.error = (e instanceof Error ? e.message : String(e)).slice(0, 150);
  }
  return info;
}

function buildClaudePrompt(company: string, infos: BrowseInfo[]): string {
  return (
    `We want the PRIMARY official website of the company "${company}".\n\n` +
    "Each candidate below was actually visited; you have its page title, meta " +
    "description, final URL after redirects, and canonical URL.\n\n" +
    "Pick the ONE domain that is the company's main official site. Guidance:\n" +
    "- It must actually be THIS company (title/description should fit).\n" +
    "- Prefer the global primary domain. A .com usually outranks country-specific " +
    "TLDs (.ca, .co.uk, .ru) UNLESS evidence shows the ccTLD is the true main site.\n" +
    "- If a candidate's canonical/redirect points to another domain, treat that " +
    "target as the primary.\n" +
    "- Ignore unrelated companies or third-party pages that merely mention the name.\n\n" +
    `Candidates:\n${JSON.stringify(infos, null, 2)}\n\n` +
    "Think briefly, then finish with a line EXACTLY like:\n" +
    "DOMAIN: example.com\n" +
    "If none qualifies, finish with: DOMAIN: NONE"
  );
}

async function claudePickDomain(
  company: string,
  infos: BrowseInfo[]
): Promise<{ domain: string | null; reasoning: string }> {
  const text = await callClaudeText({
    user: buildClaudePrompt(company, infos),
    maxTokens: 700,
  });
  return { domain: parseDomainAnswer(text), reasoning: text.slice(-500) };
}

async function sendToClay(
  companyName: string,
  domain: string,
  postingId: number
): Promise<boolean> {
  const url = env.CLAY_WEBHOOK_URL;
  const token = env.CLAY_AUTH_TOKEN;
  if (!url || !token) return false;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-clay-webhook-auth": token,
      },
      // {company_name, domain} verbatim; posting_id added so Clay's async
      // callback can be routed back to the right job.
      body: JSON.stringify({
        company_name: companyName,
        domain,
        posting_id: postingId,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

export interface DomainFinderResult {
  domain: string | null;
  reasoning: string;
  sent: boolean;
  checked: string[];
}

/**
 * Run the full flow for one company and (if a domain is found) fire it to the
 * Clay webhook. Returns the chosen domain + Claude's reasoning + send status.
 */
export async function findAndSendDomain(
  companyName: string,
  postingId: number
): Promise<DomainFinderResult> {
  const candidates = await langsearchWebsites(companyName);
  const domains = toUniqueDomains(candidates);
  const infos = await Promise.all(domains.map((d) => browseDomain(d)));

  const { domain, reasoning } = await claudePickDomain(companyName, infos);
  if (!domain) {
    return { domain: null, reasoning, sent: false, checked: domains };
  }

  const sent = await sendToClay(companyName, domain, postingId);
  return { domain, reasoning, sent, checked: domains };
}
