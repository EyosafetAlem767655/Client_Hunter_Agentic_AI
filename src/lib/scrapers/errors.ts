import type { ScrapeSourceStatusValue } from "@/types";

export class ScraperStatusError extends Error {
  readonly sourceStatus: Exclude<ScrapeSourceStatusValue, "scraped" | "not_attempted">;

  constructor(
    sourceStatus: Exclude<ScrapeSourceStatusValue, "scraped" | "not_attempted">,
    message: string
  ) {
    super(message);
    this.name = "ScraperStatusError";
    this.sourceStatus = sourceStatus;
  }
}

export class ScraperRejectedError extends ScraperStatusError {
  constructor(message: string) {
    super("rejected", message);
    this.name = "ScraperRejectedError";
  }
}

export class ScraperNotConfiguredError extends ScraperStatusError {
  constructor(message: string) {
    super("not_configured", message);
    this.name = "ScraperNotConfiguredError";
  }
}

export function scraperStatusFromError(error: unknown): "rejected" | "not_configured" {
  if (error instanceof ScraperStatusError) return error.sourceStatus;
  return "rejected";
}
