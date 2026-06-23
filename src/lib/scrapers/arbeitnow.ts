import type { RawPosting } from "@/types";
import { prioritizeTargetPostings } from "@/lib/job-relevance";
import { BaseScraper } from "./base";

interface ArbeitnowJob {
  slug: string;
  company_name: string;
  title: string;
  description: string;
  remote: boolean;
  url: string;
  tags: string[];
  job_types: string[];
  location: string;
  created_at: number;
}

interface ArbeitnowResponse {
  data?: ArbeitnowJob[];
  links?: {
    next?: string | null;
  };
}

/**
 * Arbeitnow — EU-focused remote job board with an open JSON feed.
 * https://www.arbeitnow.com/api/job-board-api
 *
 * Good source for European VA / customer support listings. No auth.
 */
export class ArbeitnowScraper extends BaseScraper {
  constructor(contactEmail: string) {
    super("arbeitnow", contactEmail);
  }

  async fetch(limit: number): Promise<RawPosting[]> {
    const urls = [
      "https://www.arbeitnow.com/api/job-board-api",
      "https://arbeitnow.com/api/job-board-api",
    ];

    for (const url of urls) {
      const all: RawPosting[] = [];
      const seen = new Set<string>();
      let nextUrl: string | null = url;
      let page = 0;
      try {
        while (nextUrl && page < arbeitnowMaxPages()) {
          const res = await this.fetchWithRetry(nextUrl);
          const data = (await res.json()) as ArbeitnowResponse;
          for (const job of data.data ?? []) {
            if (seen.has(job.slug)) continue;
            seen.add(job.slug);
            all.push({
              source: "arbeitnow" as const,
              externalId: job.slug,
              url: job.url,
              title: job.title,
              company: job.company_name,
              location: job.location || (job.remote ? "Remote (EU)" : "Europe"),
              description: job.description ?? "",
              postedAt: job.created_at ? new Date(job.created_at * 1000) : null,
              raw: job as unknown as Record<string, unknown>,
            });
          }
          page++;
          nextUrl = data.links?.next
            ? new URL(data.links.next, nextUrl).toString()
            : null;
        }
        return prioritizeTargetPostings(all, limit);
      } catch {
        if (all.length > 0) return prioritizeTargetPostings(all, limit);
        // Try the next URL variant
      }
    }
    return [];
  }
}

function arbeitnowMaxPages(): number {
  const configured = Number(process.env.ARBEITNOW_MAX_PAGES);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.max(1, Math.floor(configured));
  }
  return process.env.VERCEL === "1" ? 4 : 8;
}
