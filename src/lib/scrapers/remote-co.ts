import * as cheerio from "cheerio";
import type { RawPosting } from "@/types";
import { BaseScraper } from "./base";
import { ScraperRejectedError } from "./errors";
import { absoluteUrl, dedupePostings, textFrom } from "./html-card";

const CATEGORY_URLS = [
  "https://remote.co/remote-jobs/customer-service/",
  "https://remote.co/remote-jobs/virtual-assistant/",
  "https://remote.co/remote-jobs/data-entry/",
  "https://remote.co/remote-jobs/marketing/",
  "https://remote.co/remote-jobs/sales/",
];

export class RemoteCoScraper extends BaseScraper {
  constructor(contactEmail: string) {
    super("remote_co", contactEmail);
    this.acceptHeader = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8";
  }

  async fetch(limit: number): Promise<RawPosting[]> {
    const out: RawPosting[] = [];
    for (const url of CATEGORY_URLS) {
      if (out.length >= limit) break;
      const parsed = new URL(url);
      if (!(await this.respectRobots(parsed.origin, parsed.pathname))) continue;
      const response = await this.fetchWithRetry(url);
      const html = await response.text();
      out.push(...this.parseJsonLdPostings(html, url));
      out.push(...this.parseCards(html, url));
    }
    const deduped = dedupePostings(out).slice(0, limit);
    if (deduped.length === 0) {
      throw new ScraperRejectedError("Remote.co returned no parseable postings");
    }
    return deduped;
  }

  private parseCards(html: string, pageUrl: string): RawPosting[] {
    const $ = cheerio.load(html);
    const out: RawPosting[] = [];
    $("a[href*='/job/'], a[href*='/remote-jobs/']").each((_, el) => {
      const link = $(el);
      const url = absoluteUrl(link.attr("href"), pageUrl);
      if (!url || url === pageUrl) return;
      const card = link.closest("li, article, div");
      const title =
        textFrom(card, ["h2", "h3", ".font-weight-bold", ".job-title"]) ||
        link.text().replace(/\s+/g, " ").trim();
      if (!title || title.length < 3) return;
      const company = textFrom(card, [".company", ".company-name", "span"]);
      const location = textFrom(card, [".location", ".badge", "small"]);
      out.push({
        source: "remote_co",
        externalId: this.hashId(url),
        url,
        title,
        company: company || "Unknown company",
        location: location || "Remote",
        description: card.text().replace(/\s+/g, " ").trim() || title,
        postedAt: null,
        raw: { url, title, company, location },
      });
    });
    return out;
  }
}
