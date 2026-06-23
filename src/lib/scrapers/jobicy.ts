import type { RawPosting } from "@/types";
import { BaseScraper } from "./base";

interface JobicyJob {
  id: number | string;
  url: string;
  jobTitle: string;
  companyName: string;
  jobGeo?: string;
  jobLevel?: string;
  jobType?: string[];
  jobIndustry?: string[];
  jobDescription?: string;
  pubDate?: string;
  jobExcerpt?: string;
}

interface JobicyResponse {
  jobs?: JobicyJob[];
}

/**
 * Jobicy — remote-only job board with a friendly public API.
 * https://jobicy.com/api/v2/remote-jobs
 *
 * Supports server-side filtering for VA-style categories. No auth.
 */
export class JobicyScraper extends BaseScraper {
  constructor(contactEmail: string) {
    super("jobicy", contactEmail);
  }

  async fetch(limit: number): Promise<RawPosting[]> {
    const tagQueries = [
      "virtual-assistant",
      "customer-service",
      "customer-support",
      "administrative",
      "operations",
      "data-entry",
      "hr",
      "finance",
      "social-media",
      "sales",
      "marketing",
    ];

    const seen = new Set<string>();
    const all: RawPosting[] = [];

    for (const tag of tagQueries) {
      if (all.length >= limit) break;
      const url = `https://jobicy.com/api/v2/remote-jobs?count=${limit}&tag=${encodeURIComponent(tag)}`;
      try {
        const res = await this.fetchWithRetry(url);
        const data = (await res.json()) as JobicyResponse;
        for (const job of data.jobs ?? []) {
          if (all.length >= limit) break;
          const key = String(job.id);
          if (seen.has(key)) continue;
          seen.add(key);
          all.push({
            source: "jobicy",
            externalId: key,
            url: job.url,
            title: job.jobTitle,
            company: job.companyName,
            location: job.jobGeo || "Remote",
            description: job.jobDescription || job.jobExcerpt || "",
            postedAt: job.pubDate ? new Date(job.pubDate) : null,
            raw: job as unknown as Record<string, unknown>,
          });
        }
      } catch {
        // Skip this tag query if it fails
      }
    }
    return all;
  }
}
