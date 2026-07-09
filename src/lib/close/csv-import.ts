import * as XLSX from "xlsx";

/**
 * Maps an arbitrary enrichment export (Cleanlist, Sendr, Clay, Apollo, …) onto
 * Close's lead + contact shape.
 *
 * Every provider names its columns differently, so headers are matched against
 * alias lists rather than fixed positions. Rows sharing a company collapse into
 * a single lead carrying many contacts — the same grouping Close's own importer
 * applies.
 */

export interface ImportContact {
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
}

export interface ImportLead {
  company: string;
  website?: string;
  description?: string;
  city?: string;
  state?: string;
  country?: string;
  contacts: ImportContact[];
}

export interface ParseResult {
  leads: ImportLead[];
  /** Headers we understood, as `field -> original header`. */
  mapped: Record<string, string>;
  /** Headers present in the file that we ignored. */
  unmapped: string[];
  rowCount: number;
  skippedRows: number;
  warnings: string[];
}

/** Fields we can pull out of a row, each with headers we accept for it. */
const ALIASES: Record<string, string[]> = {
  company:         ["company", "companyname", "organization", "organisation", "account", "accountname", "employer"],
  website:         ["companywebsite", "website", "companyurl", "companydomain", "domain", "url"],
  fullName:        ["fullname", "contactname", "name"],
  firstName:       ["firstname", "first"],
  lastName:        ["lastname", "last"],
  title:           ["jobtitle", "title", "position", "role"],
  email:           ["findemail", "email", "workemail", "businessemail", "emailaddress", "primaryemail", "contactemail"],
  phone:           ["phone", "phonenumber", "mobile", "mobilenumber", "workphone", "contactphone", "directdial"],
  linkedinUrl:     ["linkedinurl", "linkedin", "linkedinprofile", "personlinkedinurl", "profileurl"],
  companyLinkedin: ["companylinkedinurl", "companylinkedin"],
  industries:      ["companyindustries", "industries", "industry"],
  employees:       ["employees", "employeecount", "companysize", "headcount"],
  city:            ["city", "locality"],
  state:           ["state", "region", "province"],
  country:         ["country"],
};

/** Lowercase and drop everything that isn't a letter or digit. */
export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Resolve each field to the first header that matches one of its aliases, in
 * alias order — so "Find Email" wins over a stray "Email" column, and the
 * caller sees exactly which of their headers we bound to.
 */
export function detectColumns(headers: string[]): Record<string, string> {
  const byNormalized = new Map<string, string>();
  for (const h of headers) {
    const n = normalizeHeader(h);
    if (n && !byNormalized.has(n)) byNormalized.set(n, h);
  }

  const mapped: Record<string, string> = {};
  for (const [field, aliases] of Object.entries(ALIASES)) {
    for (const alias of aliases) {
      const original = byNormalized.get(alias);
      if (original) {
        mapped[field] = original;
        break;
      }
    }
  }
  return mapped;
}

function text(row: Record<string, unknown>, header: string | undefined): string {
  if (!header) return "";
  const raw = row[header];
  if (raw === null || raw === undefined) return "";
  return String(raw).trim();
}

/** Close rejects a lead URL without a scheme. */
function normalizeWebsite(value: string): string | undefined {
  const v = value.trim();
  if (!v) return undefined;
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v.replace(/^\/+/, "")}`;
}

function buildDescription(row: Record<string, unknown>, cols: Record<string, string>): string | undefined {
  const parts = [
    text(row, cols.industries) && `Industries: ${text(row, cols.industries)}`,
    text(row, cols.employees) && `Employees: ${text(row, cols.employees)}`,
    text(row, cols.companyLinkedin) && `LinkedIn: ${text(row, cols.companyLinkedin)}`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function contactName(row: Record<string, unknown>, cols: Record<string, string>): string {
  const full = text(row, cols.fullName);
  if (full) return full;
  const joined = [text(row, cols.firstName), text(row, cols.lastName)].filter(Boolean).join(" ");
  if (joined) return joined;
  // An email with no name is still worth importing — Close shows the address.
  const email = text(row, cols.email);
  return email ? email.split("@")[0] : "";
}

/**
 * Turn already-parsed rows into Close leads. Rows with no company are dropped
 * (Close keys leads on company name); rows whose contact carries no email,
 * phone or LinkedIn URL contribute company data but no contact.
 */
export function rowsToLeads(rows: Record<string, unknown>[]): ParseResult {
  // Union of every row's keys — a sparse first row must not hide later columns.
  const headers = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const cols = detectColumns(headers);
  const mappedHeaders = new Set(Object.values(cols));
  const unmapped = headers.filter((h) => !mappedHeaders.has(h) && normalizeHeader(h) !== "");

  const warnings: string[] = [];
  if (!cols.company) warnings.push('No "Company" column found — nothing can be imported.');
  if (!cols.email && !cols.phone && !cols.linkedinUrl) {
    warnings.push("No email, phone or LinkedIn column found — leads will import without reachable contacts.");
  }

  const byCompany = new Map<string, ImportLead>();
  let skippedRows = 0;

  for (const row of rows) {
    const company = text(row, cols.company);
    if (!company) {
      skippedRows++;
      continue;
    }

    const key = company.toLowerCase();
    let lead = byCompany.get(key);
    if (!lead) {
      lead = {
        company,
        website: normalizeWebsite(text(row, cols.website)),
        description: buildDescription(row, cols),
        city: text(row, cols.city) || undefined,
        state: text(row, cols.state) || undefined,
        country: text(row, cols.country) || undefined,
        contacts: [],
      };
      byCompany.set(key, lead);
    } else {
      // Later rows can fill in company fields the first row left blank.
      lead.website ??= normalizeWebsite(text(row, cols.website));
      lead.description ??= buildDescription(row, cols);
      lead.city ??= text(row, cols.city) || undefined;
      lead.state ??= text(row, cols.state) || undefined;
      lead.country ??= text(row, cols.country) || undefined;
    }

    const email = text(row, cols.email);
    const phone = text(row, cols.phone);
    const linkedinUrl = text(row, cols.linkedinUrl);
    const name = contactName(row, cols);
    if (!name && !email && !phone && !linkedinUrl) continue;

    const dedupeKey = (email || linkedinUrl || name).toLowerCase();
    const already = lead.contacts.some(
      (c) => (c.email || c.linkedinUrl || c.name).toLowerCase() === dedupeKey
    );
    if (already) continue;

    lead.contacts.push({
      name: name || email || "Unknown",
      title: text(row, cols.title) || undefined,
      email: email || undefined,
      phone: phone || undefined,
      linkedinUrl: linkedinUrl || undefined,
    });
  }

  return {
    leads: Array.from(byCompany.values()),
    mapped: cols,
    unmapped,
    rowCount: rows.length,
    skippedRows,
    warnings,
  };
}

/** Read the first sheet of a .csv or .xlsx upload into row objects. */
export function parseSpreadsheet(buffer: Buffer): Record<string, unknown>[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const first = workbook.SheetNames[0];
  if (!first) return [];
  // `raw: false` formats numbers/dates as the strings the user sees in Excel.
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[first], {
    defval: "",
    raw: false,
  });
}

/** Shape one parsed lead into Close's `POST /lead/` body. */
export function toClosePayload(lead: ImportLead, statusId?: string): Record<string, unknown> {
  const address =
    lead.city || lead.state || lead.country
      ? [{ label: "business", city: lead.city, state: lead.state, country: lead.country }]
      : undefined;

  return {
    name: lead.company,
    url: lead.website,
    description: lead.description,
    ...(statusId ? { status_id: statusId } : {}),
    ...(address ? { addresses: address } : {}),
    contacts: lead.contacts.map((c) => ({
      name: c.name,
      title: c.title,
      emails: c.email ? [{ email: c.email, type: "office" }] : [],
      phones: c.phone ? [{ phone: c.phone, type: "office" }] : [],
      urls: c.linkedinUrl ? [{ url: c.linkedinUrl, type: "url" }] : [],
    })),
  };
}
