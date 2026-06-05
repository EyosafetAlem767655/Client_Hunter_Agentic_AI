import { describe, expect, it } from "vitest";
import {
  discoverContactsForPosting,
  discoverViaSearch,
  findCompanyHomepage,
  isUsefulEmail,
} from "@/lib/contact/discovery";

describe("isUsefulEmail filtering", () => {
  it("drops noreply / postmaster locals", () => {
    expect(isUsefulEmail("noreply@acme.com")).toBe(false);
    expect(isUsefulEmail("postmaster@acme.com")).toBe(false);
  });

  it("drops job-board and tracker domains", () => {
    expect(isUsefulEmail("foo@sentry.io")).toBe(false);
    expect(isUsefulEmail("hr@indeed.com")).toBe(false);
    expect(isUsefulEmail("careers@example.com")).toBe(false);
    expect(isUsefulEmail("contact@greenhouse.io")).toBe(false);
  });

  it("keeps plausible employer emails", () => {
    expect(isUsefulEmail("careers@acmestartup.io")).toBe(true);
    expect(isUsefulEmail("hello@widget.co")).toBe(true);
  });
});

describe("discoverViaSearch", () => {
  it("extracts emails from search-result HTML and ranks role-based addresses higher", async () => {
    const html =
      'snippet ... <a>careers@acmestartup.io</a> and hello@acmestartup.io ...';
    const fetchMock = async () => html;
    const results = await discoverViaSearch("AcmeStartup", fetchMock);
    expect(results.length).toBeGreaterThan(0);
    const careers = results.find((c) => c.email === "careers@acmestartup.io");
    const hello = results.find((c) => c.email === "hello@acmestartup.io");
    expect(careers).toBeDefined();
    expect(hello).toBeDefined();
    expect(careers!.confidence).toBeGreaterThan(hello!.confidence);
  });

  it("returns [] when search fetch fails", async () => {
    const fetchMock = async () => {
      throw new Error("blocked");
    };
    const results = await discoverViaSearch("X", fetchMock);
    expect(results).toEqual([]);
  });
});

describe("findCompanyHomepage", () => {
  it("returns the first non-job-board URL from the search results", async () => {
    const html = `
      <a href="https://html.duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.linkedin.com%2Fcompany%2Facme">linkedin</a>
      <a href="https://html.duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.acmestartup.io%2Fabout">homepage</a>
    `;
    const fetchMock = async () => html;
    const url = await findCompanyHomepage("Acme", fetchMock);
    expect(url).toBe("https://acmestartup.io");
  });

  it("returns null on fetch failure", async () => {
    const fetchMock = async () => {
      throw new Error("blocked");
    };
    expect(await findCompanyHomepage("Acme", fetchMock)).toBeNull();
  });
});

describe("discoverContactsForPosting end-to-end fallback chain", () => {
  it("returns body emails immediately when present", async () => {
    const out = await discoverContactsForPosting({
      description: "Apply at hiring@realcompany.com",
      url: "https://acmestartup.io/jobs/1",
      company: "Acme",
    });
    expect(out[0].email).toBe("hiring@realcompany.com");
    expect(out[0].sourceType).toBe("listed");
  });
});
