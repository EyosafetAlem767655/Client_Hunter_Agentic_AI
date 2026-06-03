import * as cheerio from "cheerio";
import type { RawPosting } from "@/types";
import { BaseScraper } from "./base";

const FEEDS = [
  "https://weworkremotely.com/categories/remote-programming-jobs.rss",
  "https://weworkremotely.com/categories/remote-design-jobs.rss",
  "https://weworkremotely.com/categories/remote-customer-support-jobs.rss",
  "https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss",
  "https://weworkremotely.com/categories/remote-sales-marketing-jobs.rss",
];

export class WeWorkRemotelyScraper extends BaseScraper {
  constructor(contactEmail: string) {
    super("weworkremotely", contactEmail);
  }

  async fetch(limit: number): Promise<RawPosting[]> {
    const postings: RawPosting[] = [];

    for (const feedUrl of FEEDS) {
      if (postings.length >= limit) break;
      const origin = new URL(feedUrl).origin;
      const allowed = await this.respectRobots(origin, new URL(feedUrl).pathname);
      if (!allowed) continue;

      await this.paginatedJitter();
      const response = await this.fetchWithRetry(feedUrl);
      const xml = await response.text();
      const $ = cheerio.load(xml, { xmlMode: true });

      $("item").each((_, el) => {
        if (postings.length >= limit) return false;
        const item = $(el);
        const title = item.find("title").text().trim();
        const link = item.find("link").text().trim();
        const description = item.find("description").text().trim();
        const pubDate = item.find("pubDate").text().trim();
        const guid = item.find("guid").text().trim() || link;
        const company = title.includes(":") ? title.split(":")[0].trim() : "Unknown";

        postings.push({
          source: "weworkremotely",
          externalId: this.hashId(guid),
          url: link,
          title: title.includes(":") ? title.split(":").slice(1).join(":").trim() : title,
          company,
          location: "Remote",
          description,
          postedAt: pubDate ? new Date(pubDate) : null,
          raw: { title, link, description, pubDate, guid },
        });
      });
    }

    return postings.slice(0, limit);
  }
}
