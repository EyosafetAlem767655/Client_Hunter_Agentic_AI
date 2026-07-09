import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  detectColumns,
  normalizeHeader,
  parseSpreadsheet,
  rowsToLeads,
  toClosePayload,
} from "@/lib/close/csv-import";

/** A trimmed row in the shape Cleanlist/Sendr exports use. */
const CLEANLIST_ROW = {
  "Full name": "James Hansen",
  "First name": "James",
  "Last name": "Hansen",
  "Job title": "Head of Partnerships",
  "Company": "Ocra",
  "Headline": "Head of Partnerships @ Ocra",
  "LinkedIn URL": "https://www.linkedin.com/in/jameshansenhotels",
  "Company LinkedIn URL": "https://www.linkedin.com/company/getocra",
  "Company website": "https://go.getocra.com",
  "Company industries": "parking,saas",
  "City": "Palm Beach Gardens",
  "State": "Florida",
  "Country": "United States",
  "Employees": "50",
  "Find Email": "james@getocra.com",
};

describe("normalizeHeader", () => {
  it("strips case, spaces and punctuation", () => {
    expect(normalizeHeader("Company website")).toBe("companywebsite");
    expect(normalizeHeader("Find Email")).toBe("findemail");
    expect(normalizeHeader("  E-Mail_Address ")).toBe("emailaddress");
  });
});

describe("detectColumns", () => {
  it("binds each field to the first matching alias", () => {
    const cols = detectColumns(Object.keys(CLEANLIST_ROW));
    expect(cols.company).toBe("Company");
    expect(cols.website).toBe("Company website");
    expect(cols.email).toBe("Find Email");
    expect(cols.linkedinUrl).toBe("LinkedIn URL");
    expect(cols.companyLinkedin).toBe("Company LinkedIn URL");
  });

  it("prefers 'Find Email' over a plain 'Email' column", () => {
    const cols = detectColumns(["Company", "Email", "Find Email"]);
    expect(cols.email).toBe("Find Email");
  });

  it("does not confuse 'LinkedIn URL' with the website 'URL' alias", () => {
    const cols = detectColumns(["Company", "LinkedIn URL"]);
    expect(cols.linkedinUrl).toBe("LinkedIn URL");
    expect(cols.website).toBeUndefined();
  });

  it("handles alternate provider naming", () => {
    const cols = detectColumns(["Organization", "Domain", "First Name", "Last Name", "Work Email", "Mobile"]);
    expect(cols.company).toBe("Organization");
    expect(cols.website).toBe("Domain");
    expect(cols.email).toBe("Work Email");
    expect(cols.phone).toBe("Mobile");
  });
});

describe("rowsToLeads", () => {
  it("maps a Cleanlist row onto a lead with one contact", () => {
    const { leads, unmapped, skippedRows, warnings } = rowsToLeads([CLEANLIST_ROW]);
    expect(leads).toHaveLength(1);
    const [lead] = leads;
    expect(lead.company).toBe("Ocra");
    expect(lead.website).toBe("https://go.getocra.com");
    expect(lead.city).toBe("Palm Beach Gardens");
    expect(lead.description).toContain("Industries: parking,saas");
    expect(lead.description).toContain("Employees: 50");
    expect(lead.contacts).toEqual([
      {
        name: "James Hansen",
        title: "Head of Partnerships",
        email: "james@getocra.com",
        phone: undefined,
        linkedinUrl: "https://www.linkedin.com/in/jameshansenhotels",
      },
    ]);
    expect(unmapped).toContain("Headline");
    expect(skippedRows).toBe(0);
    expect(warnings).toHaveLength(0);
  });

  it("groups rows sharing a company into one lead with many contacts", () => {
    const { leads } = rowsToLeads([
      { Company: "Acme", "Full name": "A One", "Find Email": "a@acme.co" },
      { Company: "acme", "Full name": "B Two", "Find Email": "b@acme.co" },
      { Company: "Other", "Full name": "C Three", "Find Email": "c@other.co" },
    ]);
    expect(leads).toHaveLength(2);
    expect(leads[0].company).toBe("Acme");
    expect(leads[0].contacts.map((c) => c.name)).toEqual(["A One", "B Two"]);
  });

  it("dedupes repeated contacts and fills blanks from later rows", () => {
    const { leads } = rowsToLeads([
      { Company: "Acme", "Full name": "A One", Email: "a@acme.co", Website: "" },
      { Company: "Acme", "Full name": "A One", Email: "a@acme.co", Website: "acme.co" },
    ]);
    expect(leads[0].contacts).toHaveLength(1);
    expect(leads[0].website).toBe("https://acme.co");
  });

  it("builds a name from first+last, then falls back to the email local part", () => {
    const { leads } = rowsToLeads([
      { Company: "Acme", "First name": "Jo", "Last name": "Kim" },
      { Company: "Beta", Email: "solo@beta.co" },
    ]);
    expect(leads[0].contacts[0].name).toBe("Jo Kim");
    expect(leads[1].contacts[0].name).toBe("solo");
  });

  it("skips rows with no company and warns when the column is missing", () => {
    const { leads, skippedRows, warnings } = rowsToLeads([
      { Company: "", "Full name": "Nobody" },
      { Company: "  ", "Full name": "Also nobody" },
    ]);
    expect(leads).toHaveLength(0);
    expect(skippedRows).toBe(2);
    expect(warnings.some((w) => w.includes("email, phone or LinkedIn"))).toBe(true);
  });

  it("warns when there is no company column at all", () => {
    const { warnings } = rowsToLeads([{ Name: "x" }]);
    expect(warnings.some((w) => w.includes("Company"))).toBe(true);
  });

  it("keeps a company with no reachable contact as a lead with no contacts", () => {
    const { leads } = rowsToLeads([{ Company: "Ghost Clinic", "Company website": "ghost.io" }]);
    expect(leads[0].contacts).toHaveLength(0);
    expect(leads[0].website).toBe("https://ghost.io");
  });
});

describe("parseSpreadsheet", () => {
  it("reads a CSV buffer into row objects", () => {
    const csv = "Company,Find Email\nAcme,a@acme.co\n";
    const rows = parseSpreadsheet(Buffer.from(csv, "utf-8"));
    expect(rows).toEqual([{ Company: "Acme", "Find Email": "a@acme.co" }]);
  });

  it("reads an xlsx buffer into row objects", () => {
    const ws = XLSX.utils.json_to_sheet([{ Company: "Acme", "Find Email": "a@acme.co" }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    expect(parseSpreadsheet(buf)).toEqual([{ Company: "Acme", "Find Email": "a@acme.co" }]);
  });

  it("returns nothing for an empty buffer sheet", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), "Sheet1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    expect(parseSpreadsheet(buf)).toEqual([]);
  });
});

describe("toClosePayload", () => {
  it("shapes a lead into Close's create-lead body", () => {
    const [lead] = rowsToLeads([CLEANLIST_ROW]).leads;
    const payload = toClosePayload(lead, "stat_123") as Record<string, unknown>;
    expect(payload.name).toBe("Ocra");
    expect(payload.url).toBe("https://go.getocra.com");
    expect(payload.status_id).toBe("stat_123");
    expect(payload.addresses).toEqual([
      { label: "business", city: "Palm Beach Gardens", state: "Florida", country: "United States" },
    ]);
    expect(payload.contacts).toEqual([
      {
        name: "James Hansen",
        title: "Head of Partnerships",
        emails: [{ email: "james@getocra.com", type: "office" }],
        phones: [],
        urls: [{ url: "https://www.linkedin.com/in/jameshansenhotels", type: "url" }],
      },
    ]);
  });

  it("omits status_id and addresses when absent", () => {
    const payload = toClosePayload({ company: "Acme", contacts: [] }) as Record<string, unknown>;
    expect(payload).not.toHaveProperty("status_id");
    expect(payload).not.toHaveProperty("addresses");
  });
});
