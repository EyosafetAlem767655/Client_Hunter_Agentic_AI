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
      try {
        const res = await this.fetchWithRetry(url);
        const data = (await res.json()) as ArbeitnowResponse;
        const postings = (data.data ?? []).map((job) => ({
          source: "arbeitnow" as const,
          externalId: job.slug,
          url: job.url,
          title: job.title,
          company: job.company_name,
          location: job.location || (job.remote ? "Remote (EU)" : "Europe"),
          description: job.description ?? "",
          postedAt: job.created_at ? new Date(job.created_at * 1000) : null,
          raw: job as unknown as Record<string, unknown>,
        }));
        return prioritizeTargetPostings(postings, limit);
      } catch {
        // Try the next URL variant
      }
    }
    return [];
  }
}
