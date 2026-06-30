import type { RawPosting } from "@/types";
import { BaseScraper } from "./base";

const SEARCH_TERMS = [
  "medical+receptionist", "patient+coordinator", "medical+billing",
  "prior+authorization", "insurance+verification", "medical+administrative",
  "appointment+scheduler", "medical+records", "referral+coordinator",
  "medical+biller", "revenue+cycle", "dental+receptionist",
  "intake+coordinator", "scheduling+coordinator",
];

export class WwrDomScraper extends BaseScraper {
  constructor(contactEmail: string) {
    super("wwr_dom", contactEmail);
    this.acceptHeader = "application/rss+xml,application/xml;q=0.9,*/*;q=0.8";
  }

  async fetch(limit: number): Promise<RawPosting[]> {
    const out: RawPosting[] = [];
    const seen = new Set<string>();

    for (const term of SEARCH_TERMS) {
      if (out.length >= limit) break;
      try {
        const url = `https://weworkremotely.com/remote-jobs/search.rss?term=${term}`;
        const res = await this.fetchWithRetry(url);
        const xml = await res.text();

        // Parse RSS XML manually (no external XML parser needed — the format is simple)
        const items = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? [];
        for (const item of items) {
          if (out.length >= limit) break;

          // Extract <link> — in RSS 2.0 it sits between tags with no attr
          const linkMatch = item.match(/<link>\s*(https?:\/\/[^\s<]+)/);
          // Fallback: GUID often holds the URL
          const guidMatch = item.match(/<guid[^>]*>\s*(https?:\/\/[^\s<]+)/);
          const link = (linkMatch?.[1] ?? guidMatch?.[1] ?? "").trim();
          if (!link || seen.has(link)) continue;
          seen.add(link);

          // Title: may be CDATA wrapped
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
        // Move to next term
      }
    }
    return out;
  }
}
