import * as cheerio from "cheerio";
import type { RawPosting } from "@/types";
import { BaseScraper } from "./base";
import { MEDICAL_VA_TITLES } from "./job-titles";

const QUERIES: readonly string[] = MEDICAL_VA_TITLES;

// f_WT=2 = remote work type, f_TPR=r604800 = past week
// Each location variant has a max page count to control request volume.
// US: paginate fully (3 pages × 10 results). Philippines: 1 page each (catches
// US companies that deliberately target Philippine remote talent).
const LOCATION_VARIANTS: Array<{ param: string; pageStarts: number[] }> = [
  { param: "United+States", pageStarts: [0, 10, 20] },
  { param: "Philippines",   pageStarts: [0] },
];

export class LinkedInScraper extends BaseScraper {
  constructor(contactEmail: string) {
    super("linkedin", contactEmail);
    this.acceptHeader = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8";
  }

  async fetch(limit: number): Promise<RawPosting[]> {
    const seen = new Set<string>();
    const all: RawPosting[] = [];

    for (const query of QUERIES) {
      if (all.length >= limit) break;
      const encoded = encodeURIComponent(query);

      for (const { param, pageStarts } of LOCATION_VARIANTS) {
        if (all.length >= limit) break;

        for (const start of pageStarts) {
          if (all.length >= limit) break;
          try {
            const url =
              `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search` +
              `?keywords=${encoded}&location=${param}&f_WT=2&f_TPR=r604800&start=${start}`;

            const res = await this.fetchWithRetry(url);
            const html = await res.text();
            const $ = cheerio.load(html);
            let pageCount = 0;

            $("li").each((_, el) => {
              if (all.length >= limit) return false;
              const li = $(el);

              const link = li.find("a.base-card__full-link").first();
              const href = (link.attr("href") ?? "").split("?")[0].trim();
              if (!href || !href.includes("linkedin.com/jobs/view/")) return;
              if (seen.has(href)) return;
              seen.add(href);

              const title = li.find("h3.base-search-card__title").first().text().trim();
              const company = li.find("h4.base-search-card__subtitle").first().text().trim();
              const location = li.find(".job-search-card__location").first().text().trim();

              if (!title) return;
              pageCount++;

              all.push({
                source: "linkedin",
                externalId: this.hashId(href),
                url: href,
                title,
                company: company || "Unknown",
                location: location || "Remote",
                description: `${title} at ${company || "Unknown"}`,
                postedAt: null,
                raw: { title, company, location },
              });
            });

            // Stop paginating this query+location if page returned fewer than 10 results
            if (pageCount < 10) break;
          } catch {
            break;
          }
        }
      }
    }

    return all;
  }
}
