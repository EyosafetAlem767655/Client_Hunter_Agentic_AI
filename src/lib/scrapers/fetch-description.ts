import * as cheerio from "cheerio";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Convert an HTML fragment/snippet to clean plain text. Scrapers (Indeed) store
 * raw HTML snippets, which render as literal tags in the UI and pollute the LLM
 * prompt. This normalizes them to readable prose. Returns the input trimmed when
 * it contains no markup.
 */
export function htmlToText(html: string): string {
  if (!html) return "";
  if (!/[<&]/.test(html)) return html.replace(/\s+/g, " ").trim();
  const $ = cheerio.load(html);
  $("script, style").remove();
  // Turn block/list boundaries into spaces so words don't run together.
  $("br, li, p, div, ul, ol").after(" ");
  return $.root().text().replace(/\s+/g, " ").trim();
}

/**
 * Re-fetch the full job description from the original posting URL.
 * Returns null when the page can't be fetched/parsed or nothing useful is found.
 * Shared by the per-job sync endpoint and the (24h) bulk description sync.
 */
export async function fetchFullDescription(
  url: string,
  source: string
): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);
    $("script, style, noscript, nav, header, footer").remove();

    // Indeed-specific selectors
    if (source === "indeed") {
      const sel = $(
        "#jobDescriptionText, [data-testid='jobsearch-jobDescriptionText'], .jobsearch-JobComponent-description"
      ).first();
      const text = sel.text().replace(/\s+/g, " ").trim();
      if (text.length > 150) return text.slice(0, 8_000);
    }

    // LinkedIn-specific selectors (may or may not be accessible without auth)
    if (source === "linkedin") {
      const sel = $(
        ".description__text, .show-more-less-html__markup, [class*='job-description']"
      ).first();
      const text = sel.text().replace(/\s+/g, " ").trim();
      if (text.length > 150) return text.slice(0, 8_000);
    }

    // Generic: try common job description containers by class/id patterns
    const genericSelectors = [
      "[class*='job-description']",
      "[class*='jobDescription']",
      "[class*='job_description']",
      "[id*='job-description']",
      "[id*='jobDescription']",
      "[data-automation='jobDescription']",
      "[data-cy='job-description']",
      ".posting-requirements",
      "article",
    ];
    for (const sel of genericSelectors) {
      const el = $(sel).first();
      if (!el.length) continue;
      const text = el.text().replace(/\s+/g, " ").trim();
      if (text.length > 300) return text.slice(0, 8_000);
    }

    // Last resort: largest text block in <main>
    const mainText = $("main").text().replace(/\s+/g, " ").trim();
    if (mainText.length > 500) return mainText.slice(0, 8_000);

    return null;
  } catch {
    return null;
  }
}
