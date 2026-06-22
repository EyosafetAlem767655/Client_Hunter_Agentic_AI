import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { RemoteCoScraper } from "@/lib/scrapers/remote-co";
import { WellfoundScraper } from "@/lib/scrapers/wellfound";
import { TotaljobsScraper } from "@/lib/scrapers/totaljobs";
import { StepStoneScraper } from "@/lib/scrapers/stepstone";
import { WelcomeToTheJungleScraper } from "@/lib/scrapers/welcome-to-the-jungle";
import { MonsterScraper } from "@/lib/scrapers/monster";

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
});
