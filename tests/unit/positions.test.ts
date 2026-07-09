import { describe, expect, it } from "vitest";
import { JOB_POSITIONS, indeedQueryFromUrl } from "@/lib/scrapers/positions";

describe("JOB_POSITIONS", () => {
  it("has 17 positions with unique ids and required fields", () => {
    expect(JOB_POSITIONS).toHaveLength(17);
    const ids = new Set(JOB_POSITIONS.map((p) => p.id));
    expect(ids.size).toBe(17);
    for (const p of JOB_POSITIONS) {
      expect(p.label).toBeTruthy();
      expect(p.linkedinQuery).toBeTruthy();
      expect(p.indeedUrl).toMatch(/^https:\/\/www\.indeed\.com\/jobs\?/);
      // Every Indeed URL must yield a usable server query.
      expect(indeedQueryFromUrl(p.indeedUrl).length).toBeGreaterThan(2);
    }
  });
});

describe("indeedQueryFromUrl", () => {
  it("extracts and decodes the q param", () => {
    expect(
      indeedQueryFromUrl("https://www.indeed.com/jobs?q=Front+Desk+Receptionist&l=USA&sort=date")
    ).toBe("Front Desk Receptionist");
    expect(
      indeedQueryFromUrl("https://www.indeed.com/jobs?q=Medical%20Claims%20Specialist%20remote&l=USA")
    ).toBe("Medical Claims Specialist remote");
  });

  it("returns empty string for a malformed URL or missing q", () => {
    expect(indeedQueryFromUrl("not a url")).toBe("");
    expect(indeedQueryFromUrl("https://www.indeed.com/jobs?l=USA")).toBe("");
  });
});
