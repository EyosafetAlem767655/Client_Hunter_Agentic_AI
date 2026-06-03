import * as cheerio from "cheerio";
import { env } from "@/lib/env";
import { assertAllowedUrl } from "@/lib/scrapers/base";
import type { DiscoveredContact } from "@/types";

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const MAILTO_REGEX = /mailto:([^\s"'<>]+)/gi;

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
  return Array.from(found);
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
    if (hostname.includes("github.com") || hostname.includes("linkedin")) {
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

  const paths = ["/contact", "/careers", "/jobs", "/about"];
  for (const path of paths) {
    try {
      const html = await fetchFn(`${origin}${path}`);
      const emails = extractEmailsFromText(html);
      if (emails.length > 0) {
        return emails.map((email) => ({
          email,
          sourceType: "scraped_from_site" as const,
          confidence: 0.6,
        }));
      }
    } catch {
      continue;
    }
  }
  return [];
}

export function discoverByPatternGuess(
  companyUrl: string
): DiscoveredContact[] {
  if (!env.ENABLE_PATTERN_GUESSING) return [];
  const domain = extractCompanyDomain(companyUrl);
  if (!domain) return [];

  const prefixes = ["careers@", "jobs@", "hello@", "hiring@"];
  return prefixes.map((prefix) => ({
    email: `${prefix}${domain}`,
    sourceType: "pattern_guessed" as const,
    confidence: 0.3,
  }));
}

async function defaultFetch(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "TalentBridgeBot/1.0" },
    signal: AbortSignal.timeout(15_000),
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
  const fromBody = discoverFromBody(posting.description);
  if (fromBody.length > 0) return fromBody;

  const siteUrl = posting.url;
  const fromSite = await discoverFromCompanySite(siteUrl);
  if (fromSite.length > 0) return fromSite;

  return discoverByPatternGuess(siteUrl);
}

export function extractCompanyUrlFromDescription(description: string): string | null {
  const urlMatch = description.match(/https?:\/\/[^\s<>"']+/);
  return urlMatch?.[0] ?? null;
}
