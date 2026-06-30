import type { RawPosting } from "@/types";
import { BaseScraper } from "./base";

// Category RSS feeds — these consistently have listings; search RSS returns
// empty for medical terms since WWR is tech-focused. We fetch broad admin/
// support categories and rely on the LLM filter to pick relevant postings.
const CATEGORY_FEEDS = [
  "https://weworkremotely.com/categories/remote-customer-support-jobs.rss",
  "https://weworkremotely.com/categories/remote-management-and-finance-jobs.rss",
  "https://weworkremotely.com/categories/remote-business-exec-and-management-jobs.rss",
  "https://weworkremotely.com/categories/remote-all-other-jobs.rss",
];

export class WwrDomScraper extends BaseScraper {
  constructor(contactEmail: string) {
    super("wwr_dom", contactEmail);
    this.acceptHeader = "application/rss+xml,application/xml;q=0.9,*/*;q=0.8";
  }

  async fetch(limit: number): Promise<RawPosting[]> {
    const out: RawPosting[] = [];
    const seen = new Set<string>();

    for (const feedUrl of CATEGORY_FEEDS) {
      if (out.length >= limit) break;
      try {
        const res = await this.fetchWithRetry(feedUrl);
        const xml = await res.text();

        const items = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? [];
        for (const item of items) {
          if (out.length >= limit) break;

          const linkMatch = item.match(/<link>\s*(https?:\/\/[^\s<]+)/);
          const guidMatch = item.match(/<guid[^>]*>\s*(https?:\/\/[^\s<]+)/);
          const link = (linkMatch?.[1] ?? guidMatch?.[1] ?? "").trim();
          if (!link || seen.has(link)) continue;
          seen.add(link);

          const titleRaw = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ??
            item.match(/<title>(.*?)<\/title>/))?.[1]?.trim() ?? "";

          let title = titleRaw;
          let company = "Unknown";
          if (titleRaw.includes(": ")) {
            const idx = titleRaw.indexOf(": ");
            company = titleRaw.slice(0, idx).trim();
            title = titleRaw.slice(idx + 2).trim();
          }
          if (!title) continue;

          const regionMatch = item.match(/<region>(.*?)<\/region>/);
          const location = regionMatch?.[1]?.trim() || "Remote";

          out.push({
            source: "wwr_dom",
            externalId: this.hashId(link),
            url: link,
            title,
            company,
            location,
            description: `${title} at ${company}. ${location}.`,
            postedAt: null,
            raw: { link, titleRaw },
          });
        }
      } catch {
        // Move to next feed
      }
    }
    return out;
  }
}
