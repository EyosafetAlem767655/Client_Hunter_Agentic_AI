import { describe, expect, it } from "vitest";
import {
  JOB_POSITIONS,
  SCRAPE_COUNTRIES,
  indeedQueryFromUrl,
  linkedinLocationForCountry,
} from "@/lib/scrapers/positions";

describe("JOB_POSITIONS", () => {
  it("has 10 tech positions with unique ids and required fields", () => {
    expect(JOB_POSITIONS).toHaveLength(10);
    const ids = new Set(JOB_POSITIONS.map((p) => p.id));
    expect(ids.size).toBe(10);
    for (const p of JOB_POSITIONS) {
      expect(p.label).toBeTruthy();
      expect(p.linkedinQuery).toBeTruthy();
      expect(p.indeedUrl).toMatch(/^https:\/\/www\.indeed\.com\/jobs\?/);
      // Every Indeed URL must yield a usable server query.
      expect(indeedQueryFromUrl(p.indeedUrl).length).toBeGreaterThan(2);
    }
  });
});

describe("SCRAPE_COUNTRIES", () => {
  it("covers USA (Indeed + LinkedIn), UK and Canada (LinkedIn only)", () => {
    const byId = Object.fromEntries(SCRAPE_COUNTRIES.map((c) => [c.id, c]));
    expect(byId.usa.sources).toEqual(["indeed", "linkedin"]);
    expect(byId.uk.sources).toEqual(["linkedin"]);
    expect(byId.canada.sources).toEqual(["linkedin"]);
    // Indeed is USA-only.
    expect(SCRAPE_COUNTRIES.filter((c) => c.sources.includes("indeed"))).toHaveLength(1);
  });

  it("maps each country id to its LinkedIn location", () => {
    expect(linkedinLocationForCountry("usa")).toBe("United States");
    expect(linkedinLocationForCountry("uk")).toBe("United Kingdom");
    expect(linkedinLocationForCountry("canada")).toBe("Canada");
    // Unknown / undefined defaults to the US.
    expect(linkedinLocationForCountry(undefined)).toBe("United States");
    expect(linkedinLocationForCountry("mars")).toBe("United States");
  });
});

describe("indeedQueryFromUrl", () => {
  it("extracts and decodes the q param", () => {
    expect(
      indeedQueryFromUrl("https://www.indeed.com/jobs?q=Software+engineer+remote&l=USA+remote&radius=0")
    ).toBe("Software engineer remote");
    expect(
      indeedQueryFromUrl("https://www.indeed.com/jobs?q=Data%20Analyst%20remote&l=USA")
    ).toBe("Data Analyst remote");
  });

  it("returns empty string for a malformed URL or missing q", () => {
    expect(indeedQueryFromUrl("not a url")).toBe("");
    expect(indeedQueryFromUrl("https://www.indeed.com/jobs?l=USA")).toBe("");
  });
});
