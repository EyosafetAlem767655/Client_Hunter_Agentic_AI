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
  "https://weworkremotely.com/remote-jobs/search?term=medical+receptionist",
  "https://weworkremotely.com/remote-jobs/search?term=patient+coordinator",
  "https://weworkremotely.com/remote-jobs/search?term=medical+billing",
  "https://weworkremotely.com/remote-jobs/search?term=prior+authorization",
  "https://weworkremotely.com/remote-jobs/search?term=insurance+verification",
  "https://weworkremotely.com/remote-jobs/search?term=medical+administrative",
  "https://weworkremotely.com/remote-jobs/search?term=revenue+cycle",
  "https://weworkremotely.com/remote-jobs/search?term=appointment+scheduler",
  "https://weworkremotely.com/remote-jobs/search?term=referral+coordinator",
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
