import * as cheerio from "cheerio";
import type { RawPosting } from "@/types";
import { BaseScraper } from "./base";

const QUERIES = [
  "medical receptionist",
  "front desk receptionist",
  "front office coordinator",
  "patient service representative",
  "patient access representative",
  "appointment scheduler",
  "scheduling coordinator",
  "patient coordinator",
  "patient care coordinator",
  "patient intake specialist",
  "intake coordinator",
  "medical administrative assistant",
  "medical office assistant",
  "medical secretary",
  "medical records clerk",
  "health information clerk",
  "data entry clerk medical",
  "insurance verification specialist",
  "eligibility benefits verification",
  "prior authorization specialist",
  "authorization coordinator",
  "medical biller",
  "medical billing specialist",
  "accounts receivable medical",
  "claims processor medical",
  "revenue cycle specialist",
  "referral coordinator",
  "dental receptionist",
];

// Pagination offsets — LinkedIn returns 10 results per page
const PAGE_STARTS = [0, 10, 20];

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

      for (const start of PAGE_STARTS) {
        if (all.length >= limit) break;
        try {
          // f_WT=2 = remote work type, f_TPR=r604800 = past week
          const url =
            `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search` +
            `?keywords=${encoded}&location=United+States&f_WT=2&f_TPR=r604800&start=${start}`;

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

          // Stop paginating this query if the page returned fewer than 10 results
          if (pageCount < 10) break;
        } catch {
          break;
        }
      }
    }

    return all;
  }
}
