import * as cheerio from "cheerio";
import type { RawPosting } from "@/types";
import { BaseScraper } from "./base";
import { ScraperRejectedError } from "./errors";
import { absoluteUrl, dedupePostings } from "./html-card";

const SEARCH_QUERIES = [
  "virtual+assistant+remote",
  "customer+support+remote",
  "customer+service+remote",
];

export class IndeedScraper extends BaseScraper {
  constructor(contactEmail: string) {
    super("indeed", contactEmail);
    this.acceptHeader = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8";
  }

  async fetch(limit: number): Promise<RawPosting[]> {
    const out: RawPosting[] = [];
    for (const query of SEARCH_QUERIES) {
      if (out.length >= limit) break;
      const url = `https://www.indeed.com/jobs?q=${query}&l=Remote&sort=date&fromage=14`;
      const parsed = new URL(url);
      if (!(await this.respectRobots(parsed.origin, parsed.pathname + parsed.search))) continue;
      const response = await this.fetchWithRetry(url);
      const html = await response.text();
      // Try structured JSON-LD first, then fall back to card parsing
      out.push(...this.parseJsonLdPostings(html, url), ...this.parseCards(html, url));
      await this.paginatedJitter();
    }
    const postings = dedupePostings(out).slice(0, limit);
    if (postings.length === 0) {
      throw new ScraperRejectedError(
        "Indeed returned no parseable postings — likely blocked (403/captcha). " +
        "An official Indeed API feed is needed for reliable access."
      );
    }
    return postings;
  }

  private parseCards(html: string, pageUrl: string): RawPosting[] {
    const $ = cheerio.load(html);
    const out: RawPosting[] = [];

    // Try to extract embedded JSON from mosaic provider (Indeed's React state)
    $("script").each((_, el) => {
      const text = $(el).html() ?? "";
      const match = text.match(/window\.mosaic\.providerData\["mosaic-provider-jobcards"\]\s*=\s*(\{[\s\S]+?\});/);
      if (!match) return;
      try {
        const data = JSON.parse(match[1]) as {
          metaData?: {
            mosaicProviderJobCardsModel?: {
              results?: Array<{
                jobkey?: string;
                displayTitle?: string;
                company?: string;
                jobLocationCity?: string;
                jobLocationState?: string;
                snippet?: string;
                pubDate?: number;
              }>;
            };
          };
        };
        const results = data?.metaData?.mosaicProviderJobCardsModel?.results ?? [];
        for (const job of results) {
          const id = job.jobkey;
          const title = job.displayTitle;
          if (!id || !title) continue;
          const jobUrl = `https://www.indeed.com/viewjob?jk=${id}`;
          const location =
            [job.jobLocationCity, job.jobLocationState].filter(Boolean).join(", ") || "Remote";
          out.push({
            source: "indeed",
            externalId: id,
            url: jobUrl,
            title,
            company: job.company ?? "Unknown company",
            location,
            description: job.snippet ?? title,
            postedAt: job.pubDate ? new Date(job.pubDate) : null,
            raw: job,
          });
        }
      } catch {
        // embedded JSON not present or malformed
      }
    });

    if (out.length > 0) return out;

    // Fallback: parse visible HTML job cards
    $("[data-testid='slider_item'], .job_seen_beacon, .tapItem").each((_, el) => {
      const card = $(el);
      const titleEl = card.find("h2.jobTitle a, [data-testid='jobTitle'] a").first();
      const href = titleEl.attr("href") ?? card.find("a[href*='/rc/clk']").first().attr("href");
      const jobUrl = absoluteUrl(href, pageUrl);
      if (!jobUrl) return;
      const title = titleEl.text().trim() || card.find("h2").first().text().trim();
      if (!title) return;
      out.push({
        source: "indeed",
        externalId: this.hashId(jobUrl),
        url: jobUrl,
        title,
        company: card.find(".companyName, [data-testid='company-name']").first().text().trim() || "Unknown company",
        location: card.find(".companyLocation, [data-testid='text-location']").first().text().trim() || "Remote",
        description: card.find(".job-snippet, [data-testid='jobsnippet']").first().text().trim() || title,
        postedAt: null,
        raw: { url: jobUrl, title },
      });
    });

    return out;
  }
}
