import type { RawPosting } from "@/types";
import { BaseScraper } from "./base";

interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  category: string;
  job_type: string;
  publication_date: string;
  candidate_required_location: string;
  salary: string;
  description: string;
}

interface RemotiveResponse {
  jobs?: RemotiveJob[];
}

/**
 * Remotive — open JSON API, no auth required, cloud-IP friendly.
 * https://remotive.com/api/remote-jobs
 *
 * We filter on the server with the `search` and `category` params to keep
 * the payload small and focused on VA / customer-support categories.
 */
export class RemotiveScraper extends BaseScraper {
  constructor(contactEmail: string) {
    super("remotive", contactEmail);
  }

  async fetch(limit: number): Promise<RawPosting[]> {
    const queries = [
      `https://remotive.com/api/remote-jobs?category=customer-support&limit=${limit}`,
      `https://remotive.com/api/remote-jobs?search=virtual+assistant&limit=${limit}`,
      `https://remotive.com/api/remote-jobs?search=executive+assistant&limit=${limit}`,
      `https://remotive.com/api/remote-jobs?search=administrative+assistant&limit=${limit}`,
      `https://remotive.com/api/remote-jobs?search=customer+service&limit=${limit}`,
      `https://remotive.com/api/remote-jobs?search=technical+support&limit=${limit}`,
      `https://remotive.com/api/remote-jobs?search=client+support&limit=${limit}`,
      `https://remotive.com/api/remote-jobs?search=data+entry&limit=${limit}`,
      `https://remotive.com/api/remote-jobs?search=appointment+setter&limit=${limit}`,
      `https://remotive.com/api/remote-jobs?search=customer+success&limit=${limit}`,
      `https://remotive.com/api/remote-jobs?search=recruiting+coordinator&limit=${limit}`,
      `https://remotive.com/api/remote-jobs?search=billing+specialist&limit=${limit}`,
      `https://remotive.com/api/remote-jobs?search=sales+development+representative&limit=${limit}`,
    ];

    const seen = new Set<string>();
    const all: RawPosting[] = [];

    for (const url of queries) {
      if (all.length >= limit) break;
      try {
        const res = await this.fetchWithRetry(url);
        const data = (await res.json()) as RemotiveResponse;
        for (const job of data.jobs ?? []) {
          if (all.length >= limit) break;
          const key = String(job.id);
          if (seen.has(key)) continue;
          seen.add(key);
          all.push({
            source: "remotive",
            externalId: key,
            url: job.url,
            title: job.title,
            company: job.company_name,
            location: job.candidate_required_location || "Remote",
            description: job.description ?? "",
            postedAt: job.publication_date ? new Date(job.publication_date) : null,
            raw: job as unknown as Record<string, unknown>,
          });
        }
      } catch {
        // Try next query; never fail the whole scraper for one query.
      }
    }

    return all;
  }
}
