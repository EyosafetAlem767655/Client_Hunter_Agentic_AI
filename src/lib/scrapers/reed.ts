import { Buffer } from "node:buffer";
import { env } from "@/lib/env";
import type { RawPosting } from "@/types";
import { BaseScraper } from "./base";
import { ScraperNotConfiguredError } from "./errors";
import { dedupePostings, parseDate } from "./html-card";

interface ReedJob {
  jobId?: number | string;
  jobTitle?: string;
  employerName?: string;
  locationName?: string;
  jobDescription?: string;
  description?: string;
  date?: string;
  expirationDate?: string;
  jobUrl?: string;
  externalUrl?: string;
  minimumSalary?: number;
  maximumSalary?: number;
  currency?: string;
  salaryType?: string;
  [key: string]: unknown;
}

interface ReedSearchResponse {
  results?: ReedJob[];
}

const REED_QUERIES = [
  "virtual assistant",
  "executive assistant",
  "administrative assistant",
  "customer support",
  "customer service",
  "customer success",
  "data entry",
  "operations assistant",
];

export class ReedScraper extends BaseScraper {
  constructor(contactEmail: string) {
    super("reed", contactEmail);
  }

  async fetch(limit: number): Promise<RawPosting[]> {
    const apiKey = env.REED_API_KEY?.trim();
    if (!apiKey) {
      throw new ScraperNotConfiguredError("REED_API_KEY is not configured");
    }

    const auth = Buffer.from(`${apiKey}:`).toString("base64");
    const all: RawPosting[] = [];

    for (const query of REED_QUERIES) {
      if (all.length >= limit) break;
      const url = new URL("https://www.reed.co.uk/api/1.0/search");
      url.searchParams.set("keywords", query);
      url.searchParams.set("locationName", "remote");
      url.searchParams.set("resultsToTake", String(Math.min(limit, 100)));

      const response = await this.fetchWithRetry(url.toString(), {
        headers: { Authorization: `Basic ${auth}` },
      });
      const data = (await response.json()) as ReedSearchResponse;
      for (const job of data.results ?? []) {
        if (all.length >= limit) break;
        const externalId = String(job.jobId ?? "");
        if (!externalId) continue;
        const salary = formatSalary(job);
        all.push({
          source: "reed",
          externalId,
          url:
            job.jobUrl ??
            job.externalUrl ??
            `https://www.reed.co.uk/jobs/${externalId}`,
          title: job.jobTitle ?? "Unknown role",
          company: job.employerName ?? "Unknown company",
          location: job.locationName ?? "Remote",
          description: [job.jobDescription ?? job.description ?? "", salary]
            .filter(Boolean)
            .join("\n\n"),
          postedAt: parseDate(job.date),
          raw: job,
        });
      }
    }

    return dedupePostings(all).slice(0, limit);
  }
}

function formatSalary(job: ReedJob): string {
  if (!job.minimumSalary && !job.maximumSalary) return "";
  const currency = job.currency ?? "GBP";
  const range = [job.minimumSalary, job.maximumSalary]
    .filter((value): value is number => typeof value === "number")
    .join("-");
  return `Salary: ${currency} ${range}${job.salaryType ? ` ${job.salaryType}` : ""}`;
}
