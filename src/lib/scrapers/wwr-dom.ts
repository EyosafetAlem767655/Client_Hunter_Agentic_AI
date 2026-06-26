import * as cheerio from "cheerio";
import type { RawPosting } from "@/types";
import { BaseScraper } from "./base";

/**
 * DOM scraper for WeWorkRemotely VA / customer-support / admin categories.
 *
 * Parses the public HTML listing pages with cheerio. Used as a fallback
 * when the RSS endpoint or JSON sources are blocked. We sit explicitly
 * within categories that match the VA brief.
 */
const CATEGORY_URLS = [
  "https://weworkremotely.com/categories/remote-customer-support-jobs",
  "https://weworkremotely.com/remote-jobs/search?term=customer+success",
  "https://weworkremotely.com/remote-jobs/search?term=virtual+assistant",
  "https://weworkremotely.com/remote-jobs/search?term=executive+assistant",
  "https://weworkremotely.com/remote-jobs/search?term=data+entry",
  "https://weworkremotely.com/remote-jobs/search?term=operations+assistant",
  "https://weworkremotely.com/categories/remote-business-exec-management-jobs",
];

export class WwrDomScraper extends BaseScraper {
  constructor(contactEmail: string) {
    super("wwr_dom", contactEmail);
    this.acceptHeader = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8";
  }

  async fetch(limit: number): Promise<RawPosting[]> {
    const out: RawPosting[] = [];
    const seen = new Set<string>();

    for (const url of CATEGORY_URLS) {
      if (out.length >= limit) break;
      try {
        const res = await this.fetchWithRetry(url);
        const html = await res.text();
        const $ = cheerio.load(html);

        // WWR uses <li class="feature"> / <li class="new-listing-container"> per role
        const items = $("li.new-listing-container, section.jobs li").toArray();

        for (const el of items) {
          if (out.length >= limit) break;
          const li = $(el);
          const link = li.find("a[href*='/remote-jobs/']").first();
          const href = link.attr("href");
          if (!href) continue;
          const fullUrl = href.startsWith("http")
            ? href
            : `https://weworkremotely.com${href}`;

          if (seen.has(fullUrl)) continue;
          seen.add(fullUrl);

          const title =
            li
              .find(".new-listing__header__title, .title, h4")
              .first()
              .text()
              .trim() || link.text().trim();
          const company =
            li
              .find(".new-listing__company-name, .company")
              .first()
              .text()
              .trim() || "Unknown";
          const region =
            li
              .find(".new-listing__categories__category, .region")
              .first()
              .text()
              .trim() || "Remote";

          if (!title) continue;

          out.push({
            source: this.source,
            externalId: this.hashId(fullUrl),
            url: fullUrl,
            title,
            company,
            location: region,
            description: `${title} at ${company}. ${region}.`,
            postedAt: null,
            raw: { fullUrl, title, company, region },
          });
        }
      } catch {
        // Move to next category URL
      }
    }
    return out;
  }
}
