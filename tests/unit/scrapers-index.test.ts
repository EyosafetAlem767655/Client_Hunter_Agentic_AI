import { describe, expect, it } from "vitest";
import { getEnabledScrapers } from "@/lib/scrapers";

describe("scraper registry", () => {
  it("returns three enabled scrapers", () => {
    const scrapers = getEnabledScrapers();
    expect(scrapers).toHaveLength(3);
    expect(scrapers.map((s) => s.source)).toEqual([
      "remoteok",
      "weworkremotely",
      "hn",
    ]);
  });
});
