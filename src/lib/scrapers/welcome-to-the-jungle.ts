import * as cheerio from "cheerio";
import type { RawPosting } from "@/types";
import { BaseScraper } from "./base";
import { ScraperRejectedError } from "./errors";
import { absoluteUrl, dedupePostings, textFrom } from "./html-card";

const SEARCH_URLS = [
  "https://www.welcometothejungle.com/en/jobs?query=customer%20support",
  "https://www.welcometothejungle.com/en/jobs?query=virtual%20assistant",
  "https://www.welcometothejungle.com/en/jobs?query=administrative%20assistant",
  "https://www.welcometothejungle.com/en/jobs?query=operations%20assistant",
];

export class WelcomeToTheJungleScraper extends BaseScraper {
  constructor(contactEmail: string) {
    super("welcome_to_the_jungle", contactEmail);
    this.acceptHeader = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8";
  }

  async fetch(limit: number): Promise<RawPosting[]> {
    const out: RawPosting[] = [];
    for (const url of SEARCH_URLS) {
      if (out.length >= limit) break;
      const parsed = new URL(url);
      if (!(await this.respectRobots(parsed.origin, `${parsed.pathname}${parsed.search}`))) continue;
      const response = await this.fetchWithRetry(url);
      const html = await response.text();
      out.push(...this.parseJsonLdPostings(html, url), ...this.parseCards(html, url));
    }
    const postings = dedupePostings(out).slice(0, limit);
    if (postings.length === 0) {
      throw new ScraperRejectedError("Welcome to the Jungle returned no parseable postings");
    }
    return postings;
  }

  private parseCards(html: string, pageUrl: string): RawPosting[] {
    const $ = cheerio.load(html);
    const out: RawPosting[] = [];
    $("a[href*='/en/companies/'][href*='/jobs/']").each((_, el) => {
      const link = $(el);
      const url = absoluteUrl(link.attr("href"), pageUrl);
      if (!url) return;
      const card = link.closest("li, article, div");
      const title = textFrom(card, ["h2", "h3", "[data-testid*='job-title']"]) || link.text().trim();
      if (!title) return;
      out.push({
        source: "welcome_to_the_jungle",
        externalId: this.hashId(url),
        url,
        title,
        company: textFrom(card, ["[data-testid*='company']", ".company"]) || "Unknown company",
        location: textFrom(card, ["[data-testid*='location']", ".location"]) || "Europe",
        description: card.text().replace(/\s+/g, " ").trim() || title,
        postedAt: null,
        raw: { url, title },
      });
    });
    return out;
  }
}
