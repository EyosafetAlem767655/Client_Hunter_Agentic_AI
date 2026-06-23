import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as cheerio from "cheerio";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { RemoteCoScraper } from "@/lib/scrapers/remote-co";
import { WellfoundScraper } from "@/lib/scrapers/wellfound";
import { TotaljobsScraper } from "@/lib/scrapers/totaljobs";
import { StepStoneScraper } from "@/lib/scrapers/stepstone";
import { WelcomeToTheJungleScraper } from "@/lib/scrapers/welcome-to-the-jungle";
import { MonsterScraper } from "@/lib/scrapers/monster";
import {
  absoluteUrl,
  dedupePostings,
  parseDate,
  textFrom,
} from "@/lib/scrapers/html-card";
import type { RawPosting } from "@/types";

vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return {
    ...actual,
    sleep: vi.fn().mockResolvedValue(undefined),
    jitterMs: () => 0,
  };
});

const fixtures = join(process.cwd(), "tests/fixtures");

function htmlResponse(html: string) {
  return { ok: true, status: 200, text: async () => html };
}

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function stubHtml(html: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("robots.txt")) {
        return htmlResponse("User-agent: *\nAllow: /");
      }
      return htmlResponse(html);
    })
  );
}

function posting(source: RawPosting["source"], externalId: string): RawPosting {
  return {
    source,
    externalId,
    url: `https://example.com/jobs/${externalId}`,
    title: "Virtual Assistant",
    company: "Example Co",
    location: "Remote",
    description: "Inbox and calendar support.",
    postedAt: null,
    raw: {},
  };
}

describe("requested job-board scrapers", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.REED_API_KEY;
  });

  it.each([
    ["remote_co", RemoteCoScraper],
    ["wellfound", WellfoundScraper],
    ["totaljobs", TotaljobsScraper],
    ["stepstone", StepStoneScraper],
    ["welcome_to_the_jungle", WelcomeToTheJungleScraper],
    ["monster", MonsterScraper],
  ] as const)("parses JSON-LD JobPosting fixture for %s", async (source, Scraper) => {
    const html = readFileSync(join(fixtures, "jobposting-jsonld.html"), "utf-8");
    stubHtml(html);

    const out = await new Scraper("bot@example.com").fetch(1);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe(source);
    expect(out[0].title).toBe("Virtual Assistant");
    expect(out[0].company).toBe("FixtureCo");
  });

  it("maps Reed API response when REED_API_KEY is configured", async () => {
    vi.resetModules();
    process.env.REED_API_KEY = "reed-test-key";
    const body = JSON.parse(readFileSync(join(fixtures, "reed.json"), "utf-8"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(body)));

    const { ReedScraper } = await import("@/lib/scrapers/reed");
    const out = await new ReedScraper("bot@example.com").fetch(1);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      source: "reed",
      externalId: "123",
      title: "Customer Support Assistant",
      company: "ReedCo",
    });
  });

  it("marks Reed as not configured when REED_API_KEY is missing", async () => {
    vi.resetModules();
    delete process.env.REED_API_KEY;
    const { ReedScraper } = await import("@/lib/scrapers/reed");

    await expect(new ReedScraper("bot@example.com").fetch(1)).rejects.toMatchObject({
      sourceStatus: "not_configured",
    });
  });

  it("normalizes rejected source rows in the node runner", async () => {
    vi.resetModules();
    vi.doMock("@/lib/scrapers", async () => {
      const { RejectedSourceScraper } = await import("@/lib/scrapers/rejected-source");
      return {
        getEnabledScrapers: () => [
          new RejectedSourceScraper("indeed", "bot@example.com", "disabled"),
        ],
      };
    });
    const { runNodeScrapers } = await import("@/lib/scraper/node-runner");
    const result = await runNodeScrapers(1);
    expect(result.sources).toEqual([
      expect.objectContaining({
        source: "indeed",
        label: "Indeed",
        ok: false,
        status: "rejected",
        error: "disabled",
      }),
    ]);
  });

  it("uses the bounded fetch path in the node runner", async () => {
    vi.resetModules();
    const fetchWithinBudget = vi.fn().mockResolvedValue([
      posting("remote_co", "bounded-1"),
    ]);
    vi.doMock("@/lib/scrapers", () => ({
      getEnabledScrapers: () => [
        {
          source: "remote_co",
          fetchWithinBudget,
        },
      ],
    }));
    const { runNodeScrapers } = await import("@/lib/scraper/node-runner");

    const result = await runNodeScrapers(150);

    expect(fetchWithinBudget).toHaveBeenCalledWith(150, 15_000);
    expect(result.postings).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      source: "remote_co",
      status: "scraped",
      count: 1,
    });
  });

  it("reduces per-source quota and timeout on Vercel", async () => {
    vi.resetModules();
    vi.stubEnv("VERCEL", "1");
    const fetchWithinBudget = vi.fn().mockResolvedValue([]);
    vi.doMock("@/lib/scrapers", () => ({
      getEnabledScrapers: () =>
        Array.from({ length: 10 }, (_, i) => ({
          source: i === 0 ? "remote_co" : "remoteok",
          fetchWithinBudget,
        })),
    }));
    const { runNodeScrapers } = await import("@/lib/scraper/node-runner");

    await runNodeScrapers(150);

    expect(fetchWithinBudget).toHaveBeenCalledWith(40, 8_000);
    vi.unstubAllEnvs();
  });

  it("runs Vercel scrapers in small waves with a pause between waves", async () => {
    vi.resetModules();
    vi.stubEnv("VERCEL", "1");
    const events: string[] = [];
    const sources: RawPosting["source"][] = [
      "remotive",
      "arbeitnow",
      "jobicy",
      "remoteok",
      "weworkremotely",
      "monster",
    ];

    vi.doMock("@/lib/scrapers", () => ({
      getEnabledScrapers: () =>
        sources.map((source) => ({
          source,
          fetchWithinBudget: vi.fn(async () => {
            events.push(source);
            return [];
          }),
        })),
    }));
    const { sleep } = await import("@/lib/utils");
    vi.mocked(sleep).mockImplementation(async (ms) => {
      events.push(`sleep:${ms}`);
    });
    const { runNodeScrapers } = await import("@/lib/scraper/node-runner");

    await runNodeScrapers(150);

    expect(events).toEqual([
      "remotive",
      "arbeitnow",
      "jobicy",
      "remoteok",
      "sleep:250",
      "weworkremotely",
      "monster",
    ]);
    vi.unstubAllEnvs();
  });

  it("covers shared HTML-card helpers used by requested scrapers", () => {
    const $ = cheerio.load(`
      <article>
        <h3>  Customer   Support   Assistant  </h3>
        <span class="empty"></span>
      </article>
    `);
    const root = $("article");

    expect(absoluteUrl("/jobs/1", "https://example.com/search")).toBe(
      "https://example.com/jobs/1"
    );
    expect(absoluteUrl(undefined, "https://example.com/search")).toBeNull();
    expect(absoluteUrl("http://[bad", "https://example.com/search")).toBeNull();

    expect(textFrom(root, [".missing", "h3"])).toBe(
      "Customer Support Assistant"
    );
    expect(textFrom(root, [".missing", ".empty"])).toBe("");

    expect(
      dedupePostings([
        posting("remote_co", "1"),
        posting("remote_co", "1"),
        posting("wellfound", "1"),
      ]).map((item) => `${item.source}:${item.externalId}`)
    ).toEqual(["remote_co:1", "wellfound:1"]);

    expect(parseDate("2026-01-01")).toBeInstanceOf(Date);
    expect(parseDate("not-a-date")).toBeNull();
    expect(parseDate(null)).toBeNull();
  });
});
