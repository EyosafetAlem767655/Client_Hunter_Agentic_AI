import { createHash } from "crypto";
import * as cheerio from "cheerio";
import type { RawPosting } from "@/types";
import { jitterMs, sleep } from "@/lib/utils";
import { ScraperRejectedError } from "./errors";

const BLOCKED_DOMAINS = [
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "ziprecruiter.com",
];

export function assertAllowedUrl(url: string): void {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  for (const blocked of BLOCKED_DOMAINS) {
    if (hostname.includes(blocked)) {
      throw new Error(`Blocked domain: ${hostname}`);
    }
  }
}

export abstract class BaseScraper {
  readonly source: RawPosting["source"];
  protected userAgent: string;
  protected acceptHeader = "application/json, text/html, application/xml;q=0.9, */*;q=0.8";
  private robotsCache = new Map<string, string>();
  private deadlineAtMs: number | null = null;

  constructor(source: RawPosting["source"], contactEmail: string) {
    this.source = source;
    // Many job boards (RemoteOK, WeWorkRemotely, Cloudflare-fronted sites)
    // block obviously-bot User-Agents from Vercel egress IPs. Use a realistic
    // Chrome UA while still identifying ourselves in the From header.
    this.userAgent =
      process.env.SCRAPER_USER_AGENT ??
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
    void contactEmail;
  }

  abstract fetch(limit: number): Promise<RawPosting[]>;

  async fetchWithinBudget(
    limit: number,
    budgetMs: number
  ): Promise<RawPosting[]> {
    this.deadlineAtMs = Date.now() + budgetMs;
    try {
      return await this.fetch(limit);
    } finally {
      this.deadlineAtMs = null;
    }
  }

  protected async fetchWithRetry(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    assertAllowedUrl(url);
    const maxAttempts = scraperMaxAttempts();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const timeoutMs = this.nextRequestTimeoutMs(url);
        const response = await fetch(url, {
          ...options,
          headers: {
            "User-Agent": this.userAgent,
            Accept: this.acceptHeader,
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache",
            ...(options.headers ?? {}),
          },
          signal: AbortSignal.timeout(timeoutMs),
          redirect: "follow",
        });

        if (response.status === 403 || response.status === 429) {
          const err = new Error(`HTTP ${response.status} for ${url}`);
          (err as Error & { status: number }).status = response.status;
          throw err;
        }

        if (response.status >= 500) {
          throw new Error(`HTTP ${response.status} for ${url}`);
        }

        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const status = (error as Error & { status?: number }).status;
        if (status === 403 || status === 429) {
          throw lastError;
        }
        if (attempt < maxAttempts - 1) {
          await sleep(this.nextBackoffMs(2 ** attempt * 500));
        }
      }
    }

    throw lastError ?? new Error(`Failed to fetch ${url}`);
  }

  protected async respectRobots(origin: string, path: string): Promise<boolean> {
    const key = origin;
    if (!this.robotsCache.has(key)) {
      try {
        const res = await this.fetchWithRetry(`${origin}/robots.txt`);
        this.robotsCache.set(key, await res.text());
      } catch {
        this.robotsCache.set(key, "");
        return true;
      }
    }
    const robots = this.robotsCache.get(key) ?? "";
    const lines = robots.split(/\r?\n/);
    let inWildcard = false;
    const rules: Array<{ type: "allow" | "disallow"; value: string }> = [];
    for (const line of lines) {
      const trimmed = line.trim().toLowerCase();
      if (trimmed.startsWith("user-agent:")) {
        const agent = trimmed.split(":")[1]?.trim();
        inWildcard = agent === "*" || agent === "talentbridgebot";
      }
      if (inWildcard && trimmed.startsWith("disallow:")) {
        const disallowed = trimmed.split(":").slice(1).join(":").trim();
        if (disallowed) rules.push({ type: "disallow", value: disallowed });
      }
      if (inWildcard && trimmed.startsWith("allow:")) {
        const allowed = trimmed.split(":").slice(1).join(":").trim();
        if (allowed) rules.push({ type: "allow", value: allowed });
      }
    }
    const matches = rules.filter((rule) => robotsPatternMatches(rule.value, path));
    if (matches.length === 0) return true;
    matches.sort((a, b) => b.value.length - a.value.length);
    return matches[0].type === "allow";
  }

  protected async paginatedJitter(): Promise<void> {
    await sleep(jitterMs());
  }

  protected hashId(input: string): string {
    return createHash("sha256").update(input).digest("hex").slice(0, 16);
  }

  private nextRequestTimeoutMs(url: string): number {
    const requestTimeout = scraperFetchTimeoutMs();
    if (!this.deadlineAtMs) return requestTimeout;
    const remaining = this.deadlineAtMs - Date.now();
    if (remaining <= 0) {
      throw new ScraperRejectedError(
        `${this.source} scraper timed out before fetching ${url}`
      );
    }
    return Math.max(250, Math.min(requestTimeout, remaining));
  }

  private nextBackoffMs(ms: number): number {
    if (!this.deadlineAtMs) return ms;
    const remaining = this.deadlineAtMs - Date.now();
    return Math.max(0, Math.min(ms, remaining));
  }

  protected parseJsonLdPostings(html: string, pageUrl: string): RawPosting[] {
    const $ = cheerio.load(html);
    const out: RawPosting[] = [];
    $("script[type='application/ld+json']").each((_, el) => {
      const raw = $(el).contents().text();
      const parsed = safeJson(raw);
      for (const item of flattenJsonLd(parsed)) {
        if (!isJobPosting(item)) continue;
        const title = stringValue(item.title);
        if (!title) continue;
        const url = stringValue(item.url) ?? pageUrl;
        const hiringOrganization = recordValue(item.hiringOrganization);
        const organization = recordValue(item.organization);
        const identifier = recordValue(item.identifier);
        const company =
          stringValue(hiringOrganization?.name) ??
          stringValue(organization?.name) ??
          "Unknown company";
        const location = locationFromJsonLd(item.jobLocation) ?? "Remote";
        const description =
          stringValue(item.description) ??
          stringValue(item.responsibilities) ??
          title;
        const postedAtRaw = stringValue(item.datePosted);
        const postedAt = postedAtRaw ? new Date(postedAtRaw) : null;
        out.push({
          source: this.source,
          externalId: stringValue(identifier?.value) ?? this.hashId(url),
          url,
          title,
          company,
          location,
          description: stripHtml(description),
          postedAt:
            postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : null,
          raw: item,
        });
      }
    });
    return out;
  }
}

function scraperFetchTimeoutMs(): number {
  const configured = Number(process.env.SCRAPER_FETCH_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return process.env.VERCEL === "1" ? 5_000 : 20_000;
}

function scraperMaxAttempts(): number {
  const configured = Number(process.env.SCRAPER_MAX_ATTEMPTS);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.max(1, Math.floor(configured));
  }
  return process.env.VERCEL === "1" ? 1 : 3;
}

function robotsPatternMatches(pattern: string, target: string): boolean {
  const anchored = pattern.endsWith("$");
  const trimmed = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = trimmed
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  const regex = new RegExp(`^${escaped}${anchored ? "$" : ""}`);
  return regex.test(target.toLowerCase());
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function flattenJsonLd(input: unknown): Array<Record<string, unknown>> {
  if (!input) return [];
  if (Array.isArray(input)) return input.flatMap(flattenJsonLd);
  if (typeof input !== "object") return [];
  const item = input as Record<string, unknown>;
  const graph = item["@graph"];
  return [item, ...flattenJsonLd(graph)];
}

function isJobPosting(item: Record<string, unknown>): boolean {
  const type = item["@type"];
  if (Array.isArray(type)) {
    return type.some((entry) => String(entry).toLowerCase() === "jobposting");
  }
  return String(type ?? "").toLowerCase() === "jobposting";
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function locationFromJsonLd(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first || typeof first !== "object") return null;
  const item = first as Record<string, unknown>;
  const address = item.address as Record<string, unknown> | undefined;
  const parts = [
    stringValue(address?.addressLocality),
    stringValue(address?.addressRegion),
    stringValue(address?.addressCountry),
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(", ") : null;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
