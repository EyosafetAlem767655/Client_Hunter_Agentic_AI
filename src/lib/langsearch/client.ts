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

export function isLangSearchConfigured(): boolean {
  return Boolean(env.LANGSEARCH_API_KEY);
}

function appBaseUrl(): string {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
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

export async function findContactUrls(
  company: string,
  options: { count?: number; timeoutMs?: number } = {}
): Promise<LangSearchUrlResult[]> {
  if (!env.LANGSEARCH_API_KEY) return [];
  if (!company || company.trim().length < 2) return [];

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("LangSearch URL request timeout")),
    options.timeoutMs ?? 20_000
  );

  try {
    const res = await fetch(`${appBaseUrl()}/api/py/langsearch_urls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CRON_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        company: company.trim(),
        count: options.count ?? 5,
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
