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

  it("returns requested boards and folds legacy RSS into the DOM scraper row", () => {
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
                source: "remotive",
                ok: true,
                status: "scraped",
                count: 4,
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

    // REQUESTED_JOB_SOURCES are listed first, then any extras from the run
    expect(statuses.slice(0, REQUESTED_JOB_SOURCES.length).map((s) => s.source)).toEqual(
      REQUESTED_JOB_SOURCES
    );
    // Legacy RSS entries are folded into the wwr_dom row — no separate row
    expect(statuses.some((s) => s.source === "weworkremotely")).toBe(false);
    // wwr_dom (We Work Remotely DOM) is now a requested source and shows up
    expect(statuses.find((s) => s.source === "wwr_dom")).toMatchObject({
      ok: true,
      status: "scraped",
      count: 3,
    });
    // hn is now a requested visible source
    expect(statuses.find((s) => s.source === "hn")).toMatchObject({
      ok: true,
      status: "scraped",
      count: 99,
    });
    // Non-requested sources from the run are appended after the requested list
    expect(statuses.find((s) => s.source === "totaljobs")).toMatchObject({
      ok: false,
      status: "rejected",
    });
    expect(statuses.find((s) => s.source === "reed")).toMatchObject({
      ok: false,
      status: "not_configured",
    });
    expect(statuses.find((s) => s.source === "linkedin")).toMatchObject({
      status: "not_attempted",
    });
    expect(statuses.find((s) => s.source === "remotive")).toMatchObject({
      ok: true,
      status: "scraped",
      count: 4,
    });
  });
});

describe("visible job sources", () => {
  it("shows all active sources including HN Hiring", () => {
    expect(isVisibleJobSource("hn")).toBe(true);
    expect(isVisibleJobSource("remoteok")).toBe(true);
    expect(isVisibleJobSource("indeed")).toBe(true);
  });
});
