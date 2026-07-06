import { describe, expect, it } from "vitest";
import { getEnabledScrapers } from "@/lib/scrapers";

describe("scraper registry", () => {
  it("returns only the 2 enabled scrapers in order", () => {
    const scrapers = getEnabledScrapers();
    expect(scrapers.map((s) => s.source)).toEqual([
      "linkedin",
      "indeed",
    ]);
  });
});
