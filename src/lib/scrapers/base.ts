import { createHash } from "crypto";
import type { RawPosting } from "@/types";
import { jitterMs, sleep } from "@/lib/utils";

const BLOCKED_DOMAINS = [
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "ziprecruiter.com",
  "monster.com",
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
  private robotsCache = new Map<string, string>();

  constructor(source: RawPosting["source"], contactEmail: string) {
    this.source = source;
    this.userAgent = `TalentBridgeBot/1.0 (+${contactEmail})`;
  }

  abstract fetch(limit: number): Promise<RawPosting[]>;

  protected async fetchWithRetry(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    assertAllowedUrl(url);
    const maxAttempts = 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await fetch(url, {
          ...options,
          headers: {
            "User-Agent": this.userAgent,
            Accept: "application/json, text/html, application/xml",
            ...(options.headers ?? {}),
          },
          signal: AbortSignal.timeout(25_000),
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
          await sleep(2 ** attempt * 500);
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
    const lines = robots.split("\n");
    let inWildcard = false;
    for (const line of lines) {
      const trimmed = line.trim().toLowerCase();
      if (trimmed.startsWith("user-agent:")) {
        const agent = trimmed.split(":")[1]?.trim();
        inWildcard = agent === "*" || agent === "talentbridgebot";
      }
      if (inWildcard && trimmed.startsWith("disallow:")) {
        const disallowed = trimmed.split(":")[1]?.trim();
        if (disallowed && path.startsWith(disallowed)) {
          return false;
        }
      }
    }
    return true;
  }

  protected async paginatedJitter(): Promise<void> {
    await sleep(jitterMs());
  }

  protected hashId(input: string): string {
    return createHash("sha256").update(input).digest("hex").slice(0, 16);
  }
}
