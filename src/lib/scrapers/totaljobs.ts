import * as cheerio from "cheerio";
import type { RawPosting } from "@/types";
import { BaseScraper } from "./base";
import { ScraperRejectedError } from "./errors";
import { absoluteUrl, dedupePostings, textFrom } from "./html-card";

const SEARCH_URLS = [
  "https://www.totaljobs.com/jobs/remote-customer-service",
  "https://www.totaljobs.com/jobs/virtual-assistant",
  "https://www.totaljobs.com/jobs/admin-assistant",
  "https://www.totaljobs.com/jobs/data-entry",
];

export class TotaljobsScraper extends BaseScraper {
  constructor(contactEmail: string) {
    super("totaljobs", contactEmail);
    this.acceptHeader = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8";
  }

  async fetch(limit: number): Promise<RawPosting[]> {
    const out: RawPosting[] = [];
    for (const url of SEARCH_URLS) {
      if (out.length >= limit) break;
      const parsed = new URL(url);
      if (!(await this.respectRobots(parsed.origin, parsed.pathname))) continue;
      const response = await this.fetchWithRetry(url);
      const html = await response.text();
      out.push(...this.parseJsonLdPostings(html, url), ...this.parseCards(html, url));
    }
    const postings = dedupePostings(out).slice(0, limit);
    if (postings.length === 0) {
      throw new ScraperRejectedError("Totaljobs returned no parseable postings");
    }
    return postings;
  }

  private parseCards(html: string, pageUrl: string): RawPosting[] {
    const $ = cheerio.load(html);
    const out: RawPosting[] = [];
    $("a[href*='/job/'], article, [data-testid*='job']").each((_, el) => {
      const card = $(el);
      const link = card.is("a") ? card : card.find("a[href*='/job/']").first();
      const url = absoluteUrl(link.attr("href"), pageUrl);
      if (!url) return;
      const title = textFrom(card, ["h2", "h3", "[data-testid*='title']"]) || link.text().trim();
      if (!title) return;
      out.push({
        source: "totaljobs",
        externalId: this.hashId(url),
        url,
        title,
        company: textFrom(card, ["[data-testid*='company']", ".company"]) || "Unknown company",
        location: textFrom(card, ["[data-testid*='location']", ".location"]) || "Remote",
        description: card.text().replace(/\s+/g, " ").trim() || title,
        postedAt: null,
        raw: { url, title },
      });
    });
    return out;
  }
}
