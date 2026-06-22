import * as cheerio from "cheerio";
import type { RawPosting } from "@/types";

export function absoluteUrl(href: string | undefined, baseUrl: string): string | null {
  if (!href) return null;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

export function textFrom(
  root: cheerio.Cheerio<any>,
  selectors: string[]
): string {
  for (const selector of selectors) {
    const value = root.find(selector).first().text().replace(/\s+/g, " ").trim();
    if (value) return value;
  }
  return "";
}

export function dedupePostings(postings: RawPosting[]): RawPosting[] {
  const seen = new Set<string>();
  const out: RawPosting[] = [];
  for (const posting of postings) {
    const key = `${posting.source}:${posting.externalId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(posting);
  }
  return out;
}

export function parseDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
