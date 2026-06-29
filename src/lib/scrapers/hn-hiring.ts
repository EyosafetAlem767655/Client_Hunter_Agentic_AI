import type { RawPosting } from "@/types";
import { BaseScraper } from "./base";

const MEDICAL_TITLE_KEYWORDS = [
  "medical receptionist", "front desk", "patient service", "patient access",
  "appointment scheduler", "scheduling coordinator", "patient coordinator",
  "patient care coordinator", "patient intake", "intake coordinator",
  "medical administrative", "medical office assistant", "medical secretary",
  "medical records", "health information", "data entry clerk",
  "insurance verification", "eligibility", "prior authorization",
  "medical biller", "medical billing", "accounts receivable",
  "claims processor", "revenue cycle", "collections specialist",
  "referral coordinator", "dental receptionist", "patient recall",
];

interface HnSearchHit {
  objectID: string;
  title?: string;
  created_at_i?: number;
}

interface HnComment {
  id: number;
  text?: string;
  author?: string;
  created_at_i?: number;
  children?: HnComment[];
}

export class HnHiringScraper extends BaseScraper {
  constructor(contactEmail: string) {
    super("hn", contactEmail);
  }

  async fetch(limit: number): Promise<RawPosting[]> {
    const searchUrl =
      "https://hn.algolia.com/api/v1/search?query=who+is+hiring&tags=story";
    const searchRes = await this.fetchWithRetry(searchUrl);
    const searchData = (await searchRes.json()) as {
      hits: HnSearchHit[];
    };
    const latest = searchData.hits[0];
    if (!latest) return [];

    await this.paginatedJitter();
    const threadRes = await this.fetchWithRetry(
      `https://hn.algolia.com/api/v1/items/${latest.objectID}`
    );
    const thread = (await threadRes.json()) as { children?: HnComment[] };

    const postings: RawPosting[] = [];
    const walk = (comments: HnComment[] | undefined) => {
      if (!comments) return;
      for (const comment of comments) {
        const text = comment.text ?? "";
        if (text.length < 40) {
          walk(comment.children);
          continue;
        }
        const titleMatch = text.match(/(?:^|\|)\s*([^|]+?)\s*\|/);
        const title = titleMatch?.[1]?.trim() ?? `HN comment ${comment.id}`;
        postings.push({
          source: "hn",
          externalId: String(comment.id),
          url: `https://news.ycombinator.com/item?id=${comment.id}`,
          title,
          company: comment.author ?? "unknown",
          location: "Remote",
          description: text.replace(/<[^>]+>/g, " "),
          postedAt: comment.created_at_i
            ? new Date(comment.created_at_i * 1000)
            : null,
          raw: { id: comment.id, author: comment.author, text },
        });
        walk(comment.children);
      }
    };

    walk(thread.children);
    const matched = postings.filter((p) => {
      const lower = (p.title + " " + p.description).toLowerCase();
      return MEDICAL_TITLE_KEYWORDS.some((kw) => lower.includes(kw));
    });
    return matched.slice(0, limit);
  }
}
