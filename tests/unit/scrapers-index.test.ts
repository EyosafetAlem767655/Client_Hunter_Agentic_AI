import { describe, expect, it } from "vitest";
import { getEnabledScrapers } from "@/lib/scrapers";

describe("scraper registry", () => {
  it("returns only the 6 enabled medical-admin scrapers in order", () => {
    const scrapers = getEnabledScrapers();
    expect(scrapers.map((s) => s.source)).toEqual([
      "remotive",
      "jobicy",
      "wwr_dom",
      "wellfound",
      "monster",
      "hn",
    ]);
  });
});
