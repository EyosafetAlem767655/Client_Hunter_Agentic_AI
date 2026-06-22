import * as cheerio from "cheerio";
import type { RawPosting } from "@/types";
import { BaseScraper } from "./base";
import { ScraperRejectedError } from "./errors";
import { absoluteUrl, dedupePostings, textFrom } from "./html-card";

export class WellfoundScraper extends BaseScraper {
  constructor(contactEmail: string) {
    super("wellfound", contactEmail);
    this.acceptHeader = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8";
  }

  async fetch(limit: number): Promise<RawPosting[]> {
    const url = "https://wellfound.com/jobs";
    const parsed = new URL(url);
    if (!(await this.respectRobots(parsed.origin, parsed.pathname))) {
      throw new ScraperRejectedError("Wellfound robots.txt disallows /jobs");
    }
    const response = await this.fetchWithRetry(url);
    const html = await response.text();
    const postings = dedupePostings([
      ...this.parseJsonLdPostings(html, url),
      ...this.parseCards(html, url),
    ]).slice(0, limit);
    if (postings.length === 0) {
      throw new ScraperRejectedError("Wellfound returned no parseable postings");
    }
    return postings;
  }

  private parseCards(html: string, pageUrl: string): RawPosting[] {
    const $ = cheerio.load(html);
    const out: RawPosting[] = [];
    $("a[href*='/company/'][href*='/jobs/'], a[href*='/jobs/']").each((_, el) => {
      const link = $(el);
      const href = link.attr("href") ?? "";
      if (href.includes("_jobs") || href.includes("jobId=")) return;
      const url = absoluteUrl(href, pageUrl);
      if (!url) return;
      const card = link.closest("li, article, div");
      const title = textFrom(card, ["h2", "h3", "[data-test*='title']"]) || link.text().trim();
      if (!title) return;
      out.push({
        source: "wellfound",
        externalId: this.hashId(url),
        url,
        title,
        company: textFrom(card, ["[data-test*='company']", ".company"]) || "Unknown company",
        location: textFrom(card, ["[data-test*='location']", ".location"]) || "Remote",
        description: card.text().replace(/\s+/g, " ").trim() || title,
        postedAt: null,
        raw: { url, title },
      });
    });
    return out;
  }
}
