import { env } from "@/lib/env";

export interface LangSearchUrlResult {
  title: string;
  url: string;
  displayUrl: string;
  snippet: string;
  summary: string;
}

interface LangSearchWebResponse {
  data?: {
    webPages?: {
      value?: Array<{
        name?: unknown;
        url?: unknown;
        displayUrl?: unknown;
        snippet?: unknown;
        summary?: unknown;
      }>;
    };
  };
  results?: LangSearchUrlResult[];
}

const LANGSEARCH_ENDPOINT = "https://api.langsearch.com/v1/web-search";

export function isLangSearchConfigured(): boolean {
  return Boolean(env.LANGSEARCH_API_KEY);
}

export function parseLangSearchWebResults(
  data: unknown
): LangSearchUrlResult[] {
  const payload = data as LangSearchWebResponse;
  const raw = Array.isArray(payload.results)
    ? payload.results
    : payload.data?.webPages?.value;
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const results: LangSearchUrlResult[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const source = item as Record<string, unknown>;
    const url = source.url;
    if (typeof url !== "string" || !url.startsWith("http")) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    results.push({
      title: typeof source.title === "string"
        ? source.title
        : typeof source.name === "string"
          ? source.name
          : "",
      url,
      displayUrl:
        typeof source.displayUrl === "string" ? source.displayUrl : url,
      snippet: typeof source.snippet === "string" ? source.snippet : "",
      summary: typeof source.summary === "string" ? source.summary : "",
    });
  }
  return results;
}

/**
 * Search LangSearch for likely contact-page URLs for a company. Calls the
 * LangSearch HTTPS endpoint directly — no Python middleman — because the
 * self-call to `/api/py/langsearch_urls` on Vercel was failing
 * intermittently (auth between functions, cold-start, VERCEL_URL quirks)
 * even though the same `requests.post(...)` call works fine in Colab.
 *
 * Mirrors the user's verified Python snippet exactly:
 *   - URL: https://api.langsearch.com/v1/web-search
 *   - Authorization header: raw API key (no "Bearer " prefix)
 *   - Body: { query: f"contact us URL for {company}", freshness: "noLimit",
 *            summary: true, count: 5 }
 */
export async function findContactUrls(
  company: string,
  options: { count?: number; timeoutMs?: number } = {}
): Promise<LangSearchUrlResult[]> {
  const apiKey = env.LANGSEARCH_API_KEY?.trim();
  if (!apiKey) return [];
  const normalizedCompany = company?.trim();
  if (!normalizedCompany || normalizedCompany.length < 2) return [];

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("LangSearch request timeout")),
    options.timeoutMs ?? 15_000
  );

  try {
    const res = await fetch(LANGSEARCH_ENDPOINT, {
      method: "POST",
      headers: {
        // LangSearch accepts the raw key (matches the user's reference
        // snippet). Some keys ship with a `sk-` prefix already; we don't
        // add `Bearer ` because their docs and the working code don't.
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `contact us URL for ${normalizedCompany}`,
        freshness: "noLimit",
        summary: true,
        count: Math.max(1, Math.min(options.count ?? 5, 10)),
      }),
      signal: controller.signal,
    });
    if (!res.ok) return [];
    return parseLangSearchWebResults(await res.json());
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
