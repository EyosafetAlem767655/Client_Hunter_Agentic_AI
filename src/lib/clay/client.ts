import { env } from "@/lib/env";
import { sleep, withTimeout } from "@/lib/utils";

export interface ClayContact {
  name: string | null;
  title: string | null;
  email: string | null;
  linkedinUrl: string | null;
  phone: string | null;
}

export interface CompanyData {
  name: string | null;
  location: string | null;
  website: string | null;
  staffCount: number | null;
  annualRevenue: string | null;
  facilitiesCount: number | null;
}

export interface EnrichmentResult {
  company: CompanyData;
  leads: ClayContact[];
}

const PEOPLE_SEARCH_ENDPOINT = "https://api.clay.com/v1/sources/people-search/run";
const COMPANY_ENRICH_ENDPOINT = "https://api.clay.com/v1/sources/company-enrichment/run";

const TIMEOUT_MS = 20_000;
const MAX_RETRIES = 3;

export function isClayConfigured(): boolean {
  return Boolean(env.CLAY_API_KEY);
}

function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function clayPost(endpoint: string, apiKey: string, body: Record<string, unknown>): Promise<unknown> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await withTimeout(
        fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }),
        TIMEOUT_MS,
        `Clay POST ${endpoint}`
      );

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Clay API ${res.status}: ${text.slice(0, 300)}`);
      }

      return await res.json();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES - 1) await sleep(2 ** attempt * 500);
    }
  }

  throw lastError!;
}

function parseLeadsFromResponse(data: unknown): ClayContact[] {
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
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
    .map((item) => ({
      name:
        typeof item.full_name === "string"
          ? item.full_name
          : typeof item.name === "string"
            ? item.name
            : null,
      title:
        typeof item.job_title === "string"
          ? item.job_title
          : typeof item.title === "string"
            ? item.title
            : null,
      email: typeof item.email === "string" ? item.email.toLowerCase().trim() : null,
      linkedinUrl:
        typeof item.linkedin_url === "string"
          ? item.linkedin_url
          : typeof item.linkedinUrl === "string"
            ? item.linkedinUrl
            : null,
      phone:
        typeof item.phone === "string"
          ? item.phone
          : typeof item.phone_number === "string"
            ? item.phone_number
            : null,
    }));
}

function parseCompanyFromResponse(data: unknown, jobUrl: string): CompanyData {
  const domain = extractDomain(jobUrl);
  const fallback: CompanyData = {
    name: null,
    location: null,
    website: domain,
    staffCount: null,
    annualRevenue: null,
    facilitiesCount: null,
  };

  if (data === null || typeof data !== "object") return fallback;

  let item: Record<string, unknown>;
  const d = data as Record<string, unknown>;
  if (Array.isArray(d.data) && d.data.length > 0) {
    item = d.data[0] as Record<string, unknown>;
  } else if (Array.isArray(data) && (data as unknown[]).length > 0) {
    item = (data as Record<string, unknown>[])[0];
  } else {
    item = d;
  }

  const staffCount =
    typeof item.employee_count === "number"
      ? item.employee_count
      : typeof item.employees === "number"
        ? item.employees
        : null;

  return {
    name:
      typeof item.company_name === "string"
        ? item.company_name
        : typeof item.name === "string"
          ? item.name
          : null,
    location:
      typeof item.location === "string"
        ? item.location
        : typeof item.city === "string"
          ? item.city
          : null,
    website:
      typeof item.website === "string"
        ? item.website
        : typeof item.domain === "string"
          ? item.domain
          : domain,
    staffCount,
    annualRevenue:
      typeof item.annual_revenue === "string"
        ? item.annual_revenue
        : typeof item.revenue === "string"
          ? item.revenue
          : null,
    facilitiesCount:
      typeof item.num_locations === "number"
        ? item.num_locations
        : typeof item.locations_count === "number"
          ? item.locations_count
          : null,
  };
}

export async function enrichCompanyWithClay(params: {
  company: string;
  jobTitle: string;
  jobUrl: string;
}): Promise<EnrichmentResult> {
  const apiKey = env.CLAY_API_KEY?.trim();
  if (!apiKey) throw new Error("CLAY_API_KEY not configured");

  const domain = extractDomain(params.jobUrl);

  // Run people search and company enrichment in parallel; company enrichment may not exist
  const [leadsData, companyData] = await Promise.allSettled([
    clayPost(PEOPLE_SEARCH_ENDPOINT, apiKey, {
      company: params.company,
      job_title: params.jobTitle,
      job_url: params.jobUrl,
    }),
    clayPost(COMPANY_ENRICH_ENDPOINT, apiKey, {
      company_name: params.company,
      domain: domain ?? params.company,
    }),
  ]);

  const leads =
    leadsData.status === "fulfilled" ? parseLeadsFromResponse(leadsData.value) : [];

  const company =
    companyData.status === "fulfilled"
      ? parseCompanyFromResponse(companyData.value, params.jobUrl)
      : {
          name: null,
          location: null,
          website: domain,
          staffCount: null,
          annualRevenue: null,
          facilitiesCount: null,
        };

  // Fire-and-forget to Clay table webhook if configured
  if (env.CLAY_WEBHOOK_URL) {
    void fetch(env.CLAY_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_name: params.company,
        job_title: params.jobTitle,
        job_url: params.jobUrl,
        staff_count: company.staffCount,
        location: company.location,
        website: company.website,
        leads: leads.map((l) => ({ name: l.name, title: l.title, email: l.email })),
      }),
    }).catch(() => {/* ignore */});
  }

  return { company, leads };
}
