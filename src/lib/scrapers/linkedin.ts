import * as cheerio from "cheerio";
import type { RawPosting } from "@/types";
import { BaseScraper } from "./base";

const QUERIES = [
  "medical receptionist",
  "patient coordinator",
  "medical biller",
  "prior authorization specialist",
  "insurance verification specialist",
  "medical administrative assistant",
  "appointment scheduler",
  "revenue cycle specialist",
  "referral coordinator",
  "dental receptionist",
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
      try {
        const encoded = encodeURIComponent(query);
        // f_WT=2 = remote, f_TPR=r604800 = past week
        const url =
          `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search` +
          `?keywords=${encoded}&location=United+States&f_WT=2&f_TPR=r604800&start=0`;

        const res = await this.fetchWithRetry(url);
        const html = await res.text();
        const $ = cheerio.load(html);

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
      } catch {
        // Continue with next query
      }
    }

    return all;
  }
}
