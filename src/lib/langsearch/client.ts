import { env } from "@/lib/env";

/**
 * Thin client around LangSearch's company-email lookup. Public surface:
 *   findCompanyEmails(company, domain?) → string[]
 * Returns an empty array on any error so callers can fall through to the
 * next discovery method (Grok / DDG) without try/catch noise.
 */

const LANGSEARCH_API_URL = "https://api.langsearch.com/v1/company/emails";

export function isLangSearchConfigured(): boolean {
  return Boolean(env.LANGSEARCH_API_KEY);
}

interface LangSearchResponse {
  emails?: string[];
  // Some providers return objects — accept both for forward-compat.
  results?: Array<{ email?: string }>;
}

export async function findCompanyEmails(
  company: string,
  domain?: string,
  options: { timeoutMs?: number } = {}
): Promise<string[]> {
  if (!env.LANGSEARCH_API_KEY) return [];
  if (!company || company.trim().length < 2) return [];

  const params = new URLSearchParams({ company });
  if (domain) params.set("domain", domain);

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("LangSearch request timeout")),
    options.timeoutMs ?? 15_000
  );

  try {
    const res = await fetch(`${LANGSEARCH_API_URL}?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${env.LANGSEARCH_API_KEY}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const data = (await res.json()) as LangSearchResponse;
    const collected = new Set<string>();
    if (Array.isArray(data.emails)) {
      for (const e of data.emails) {
        if (typeof e === "string" && e.includes("@")) collected.add(e.toLowerCase().trim());
      }
    }
    if (Array.isArray(data.results)) {
      for (const r of data.results) {
        if (r?.email && r.email.includes("@")) collected.add(r.email.toLowerCase().trim());
      }
    }
    return Array.from(collected);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
