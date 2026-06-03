import type { RawPosting } from "@/types";
import { BaseScraper } from "./base";

interface RemoteOkJob {
  id?: string | number;
  url?: string;
  slug?: string;
  position?: string;
  company?: string;
  location?: string;
  description?: string;
  date?: string;
  [key: string]: unknown;
}

export class RemoteOkScraper extends BaseScraper {
  constructor(contactEmail: string) {
    super("remoteok", contactEmail);
  }

  async fetch(limit: number): Promise<RawPosting[]> {
    const origin = "https://remoteok.com";
    const allowed = await this.respectRobots(origin, "/api");
    if (!allowed) return [];

    const response = await this.fetchWithRetry(`${origin}/api`);
    const data = (await response.json()) as RemoteOkJob[];
    const jobs = data.slice(1, limit + 1);

    return jobs.map((job) => {
      const externalId = String(job.id ?? job.slug ?? "");
      const url = job.url ?? `${origin}/remote-jobs/${job.slug ?? externalId}`;
      return {
        source: "remoteok" as const,
        externalId,
        url,
        title: job.position ?? "Unknown role",
        company: job.company ?? "Unknown company",
        location: job.location ?? "Remote",
        description: job.description ?? "",
        postedAt: job.date ? new Date(job.date) : null,
        raw: job as Record<string, unknown>,
      };
    });
  }
}
