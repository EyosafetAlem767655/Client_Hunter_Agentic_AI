import { env } from "@/lib/env";
import { sleep, withTimeout } from "@/lib/utils";
import { callOpenAIJson } from "@/lib/llm/client";

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

// Titles that indicate a decision-maker or relevant contact at a healthcare practice
const RELEVANT_TITLE_KEYWORDS = [
  // C-suite / ownership
  "ceo", "chief executive", "president", "owner", "principal", "founder", "co-founder",
  "coo", "chief operating", "cfo", "chief financial",
  // Operations / admin
  "operations manager", "director of operations", "vp of operations",
  "administrator", "practice administrator", "office administrator",
  // Medical practice specific
  "practice manager", "practice owner", "office manager",
  "physician owner", "medical director", "clinical director",
  // HR / People
  "hr manager", "human resources", "hr director", "people operations",
  // Finance
  "billing manager", "revenue cycle",
  // Seniority signals (space-padded to avoid partial matches like "vp" inside "develop")
  "director", "vice president", " vp ",
];

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

function isRelevantLead(title: string | null): boolean {
  if (!title) return false;
  const t = ` ${title.toLowerCase()} `;
  return RELEVANT_TITLE_KEYWORDS.some((kw) => t.includes(kw));
}

async function lookupCompanyWebsite(companyName: string): Promise<string | null> {
  try {
    const result = await callOpenAIJson<{ website: string | null }>({
      model: env.OPENAI_URL_FILTER_MODEL,
      system:
        "You are a company research assistant. Given a company name, return its official website URL. Return null if you are uncertain. Return JSON only.",
      user: `Find the official website for: ${companyName}`,
      jsonSchema: {
        type: "object",
        properties: { website: { type: ["string", "null"] } },
        required: ["website"],
        additionalProperties: false,
      },
      timeoutMs: 15_000,
      maxRetries: 2,
    });
    if (!result?.website) return null;
    const raw = result.website.startsWith("http") ? result.website : `https://${result.website}`;
    return extractDomain(raw);
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

function parseCompanyFromResponse(data: unknown, fallbackDomain: string | null): CompanyData {
  const fallback: CompanyData = {
    name: null,
    location: null,
    website: fallbackDomain,
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
          : fallbackDomain,
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

  // Use OpenAI to find the company's actual website (job URL is usually a job board like Indeed)
  const companyDomain = await lookupCompanyWebsite(params.company);
  const domain = companyDomain ?? extractDomain(params.jobUrl);

  // Run people search and company enrichment in parallel
  const [leadsData, companyData] = await Promise.allSettled([
    clayPost(PEOPLE_SEARCH_ENDPOINT, apiKey, {
      company: params.company,
      job_url: params.jobUrl,
      ...(domain ? { domain } : {}),
    }),
    clayPost(COMPANY_ENRICH_ENDPOINT, apiKey, {
      company_name: params.company,
      domain: domain ?? params.company,
    }),
  ]);

  // Parse all leads then filter to relevant decision-maker / executive titles
  const rawLeads =
    leadsData.status === "fulfilled" ? parseLeadsFromResponse(leadsData.value) : [];
  const leads = rawLeads.filter((l) => isRelevantLead(l.title));

  const company =
    companyData.status === "fulfilled"
      ? parseCompanyFromResponse(companyData.value, domain)
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
