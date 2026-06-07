import { env } from "@/lib/env";

export interface ScrapedContactPage {
  url: string;
  /** Visible text of the page (Playwright `document.body.innerText` or BS4 fallback). */
  text: string;
  /** Every `mailto:` link found on the page. */
  mailtos: string[];
  /** Which engine actually scraped this page. */
  engine: "playwright" | "requests" | "requests_after_playwright_error" | "none";
  ok: boolean;
  error?: string;
}

export interface ScrapeContactResult {
  results: ScrapedContactPage[];
  engine_available: "playwright" | "requests";
}

function appBaseUrl(): string {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

/**
 * POST a list of URLs to the Python contact-scraper service. The service
 * uses Playwright (when available) or `requests + BeautifulSoup` to load
 * each page and return the rendered text + `mailto:` links. The caller
 * then hands the result to OpenAI for email extraction.
 *
 * Falls through with `ok: false` results on any HTTP failure rather than
 * throwing — the discovery loop treats no-emails as "skip" and moves on.
 */
export async function scrapeContactPages(
  urls: string[]
): Promise<ScrapeContactResult> {
  if (urls.length === 0) {
    return { results: [], engine_available: "requests" };
  }
  const endpoint = `${appBaseUrl()}/api/py/scrape_contact`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CRON_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ urls }),
    // Each company gets at most ~3 URLs and the Python side caps each
    // page at 8 s, so 30 s is a generous wall-time. Stays inside the
    // 60 s Vercel function budget when the caller chains other work.
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `scrape-contact HTTP ${response.status}: ${text.slice(0, 200)}`
    );
  }
  const data = (await response.json()) as Partial<ScrapeContactResult>;
  return {
    results: Array.isArray(data.results) ? data.results : [],
    engine_available: data.engine_available ?? "requests",
  };
}
