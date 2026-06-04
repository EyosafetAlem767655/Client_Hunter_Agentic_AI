import { describe, expect, it } from "vitest";
import { getEnabledScrapers } from "@/lib/scrapers";

describe("scraper registry", () => {
  it("returns the full set of enabled scrapers in fallback order", () => {
    const scrapers = getEnabledScrapers();
    expect(scrapers.map((s) => s.source)).toEqual([
      "remotive",
      "arbeitnow",
      "jobicy",
      "weworkremotely",
      "remoteok",
      "hn",
      "wwr_dom",
    ]);
  });
});
