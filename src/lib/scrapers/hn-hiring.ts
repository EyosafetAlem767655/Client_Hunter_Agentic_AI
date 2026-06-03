import type { RawPosting } from "@/types";
import { BaseScraper } from "./base";

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
      if (!comments || postings.length >= limit) return;
      for (const comment of comments) {
        if (postings.length >= limit) return;
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
    return postings.slice(0, limit);
  }
}
