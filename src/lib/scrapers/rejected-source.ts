import type { RawPosting } from "@/types";
import { BaseScraper } from "./base";
import { ScraperRejectedError } from "./errors";

export class RejectedSourceScraper extends BaseScraper {
  private readonly reason: string;

  constructor(source: RawPosting["source"], contactEmail: string, reason: string) {
    super(source, contactEmail);
    this.reason = reason;
  }

  async fetch(_limit: number): Promise<RawPosting[]> {
    throw new ScraperRejectedError(this.reason);
  }
}
