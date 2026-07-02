import { env } from "@/lib/env";
import { sleep, withTimeout } from "@/lib/utils";

export interface ClayContact {
  name: string | null;
  title: string | null;
  email: string | null;
  linkedinUrl: string | null;
}

// FIXME: Replace with your Clay account's actual enrichment endpoint.
// Find it in your Clay workspace under:
//   API → Table Endpoints  OR  Integrations → HTTP Request
// Common patterns:
//   https://api.clay.com/v1/sources/<source-id>/run
//   https://api.clay.com/v3/tables/<table-id>/rows
const CLAY_ENDPOINT = "https://api.clay.com/v1/sources/people-search/run";

const TIMEOUT_MS = 20_000;
const MAX_RETRIES = 3;

export function isClayConfigured(): boolean {
  return Boolean(env.CLAY_API_KEY);
}

export async function enrichCompanyWithClay(params: {
  company: string;
  jobTitle: string;
  jobUrl: string;
}): Promise<ClayContact[]> {
  const apiKey = env.CLAY_API_KEY?.trim();
  if (!apiKey) throw new Error("CLAY_API_KEY not configured");

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await withTimeout(
        fetch(CLAY_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            company: params.company,
            job_title: params.jobTitle,
            job_url: params.jobUrl,
          }),
        }),
        TIMEOUT_MS,
        "Clay enrichment"
      );

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Clay API ${res.status}: ${text.slice(0, 300)}`);
      }

      const data: unknown = await res.json();
      return parseClayResponse(data);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES - 1) await sleep(2 ** attempt * 500);
    }
  }

  throw lastError!;
}

// Handles both array and { data: [] } envelope shapes — the two most common Clay response formats.
// After the first live call, inspect rawResponse and adjust field paths below if needed.
function parseClayResponse(data: unknown): ClayContact[] {
  let raw: unknown[];
  if (Array.isArray(data)) {
    raw = data;
  } else if (
    data !== null &&
    typeof data === "object" &&
    Array.isArray((data as Record<string, unknown>).data)
  ) {
    raw = (data as Record<string, unknown>).data as unknown[];
  } else {
    raw = [];
  }

  return raw
    .filter((item): item is Record<string, unknown> =>
      item !== null && typeof item === "object"
    )
    .map((item) => ({
      name: typeof item.name === "string" ? item.name : null,
      title:
        typeof item.title === "string"
          ? item.title
          : typeof item.job_title === "string"
            ? item.job_title
            : null,
      email: typeof item.email === "string" ? item.email.toLowerCase().trim() : null,
      linkedinUrl:
        typeof item.linkedin_url === "string"
          ? item.linkedin_url
          : typeof item.linkedinUrl === "string"
            ? item.linkedinUrl
            : null,
    }));
}
