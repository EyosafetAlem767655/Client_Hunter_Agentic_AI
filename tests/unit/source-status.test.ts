import { describe, expect, it } from "vitest";
import { buildLatestScrapeSourceStatuses } from "@/lib/db/queries";
import { REQUESTED_JOB_SOURCES, isVisibleJobSource } from "@/lib/job-sources";

describe("dashboard source statuses", () => {
  it("falls back to the latest completed scrape run with source stats", () => {
    const statuses = buildLatestScrapeSourceStatuses([
      { stats: { perception: { scraped: 0 } } },
      {
        stats: {
          perception: {
            sources: [
              {
                source: "remoteok",
                label: "RemoteOK",
                ok: true,
                status: "scraped",
                count: 2,
              },
            ],
          },
        },
      },
    ]);

    expect(statuses.find((source) => source.source === "remoteok")).toMatchObject({
      ok: true,
      status: "scraped",
      count: 2,
    });
  });

  it("returns requested boards and groups We Work Remotely HTML with RSS", () => {
    const statuses = buildLatestScrapeSourceStatuses([
      {
        stats: {
          perception: {
            sources: [
              {
                source: "weworkremotely",
                ok: false,
                status: "rejected",
                count: 0,
                error: "RSS blocked",
              },
              {
                source: "wwr_dom",
                ok: true,
                status: "scraped",
                count: 3,
              },
              {
                source: "totaljobs",
                ok: false,
                status: "rejected",
                count: 0,
                error: "Totaljobs returned no parseable postings",
              },
              {
                source: "reed",
                ok: false,
                status: "not_configured",
                count: 0,
                error: "REED_API_KEY is not configured",
              },
              {
                source: "ziprecruiter",
                ok: false,
                status: "rejected",
                count: 0,
                error: "Direct scraping disabled",
              },
              {
                source: "hn",
                ok: true,
                status: "scraped",
                count: 99,
              },
            ],
          },
        },
      },
    ]);

    expect(statuses.map((source) => source.source)).toEqual(REQUESTED_JOB_SOURCES);
    expect(statuses.some((source) => source.source === "wwr_dom")).toBe(false);
    expect(statuses.some((source) => source.source === "hn")).toBe(false);
    expect(statuses.find((source) => source.source === "weworkremotely")).toMatchObject({
      ok: true,
      status: "scraped",
      count: 3,
    });
    expect(statuses.find((source) => source.source === "totaljobs")).toMatchObject({
      ok: false,
      status: "rejected",
    });
    expect(statuses.find((source) => source.source === "reed")).toMatchObject({
      ok: false,
      status: "not_configured",
    });
    expect(statuses.find((source) => source.source === "wellfound")).toMatchObject({
      status: "not_attempted",
    });
  });
});

describe("visible job sources", () => {
  it("hides legacy HN postings from visible app flows", () => {
    expect(isVisibleJobSource("hn")).toBe(false);
    expect(isVisibleJobSource("remoteok")).toBe(true);
  });
});
