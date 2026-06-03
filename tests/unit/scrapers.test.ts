import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { RemoteOkScraper } from "@/lib/scrapers/remoteok";
import { WeWorkRemotelyScraper } from "@/lib/scrapers/weworkremotely";
import { HnHiringScraper } from "@/lib/scrapers/hn-hiring";
import { assertAllowedUrl } from "@/lib/scrapers/base";

vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return {
    ...actual,
    sleep: vi.fn().mockResolvedValue(undefined),
    jitterMs: () => 0,
  };
});

const fixtures = join(process.cwd(), "tests/fixtures");

describe("scrapers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("parses RemoteOK fixture", async () => {
    const json = readFileSync(join(fixtures, "remoteok.json"), "utf-8");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (String(url).includes("robots.txt")) {
          return { ok: true, status: 200, text: async () => "" };
        }
        return {
          ok: true,
          status: 200,
          json: async () => JSON.parse(json),
        };
      })
    );

    const scraper = new RemoteOkScraper("bot@example.com");
    const postings = await scraper.fetch(5);
    expect(postings).toHaveLength(1);
    expect(postings[0].source).toBe("remoteok");
    expect(postings[0].title).toBe("Senior Engineer");
    expect(postings[0].company).toBe("Acme Corp");
  });

  it("parses WeWorkRemotely RSS fixture", async () => {
    const xml = readFileSync(join(fixtures, "wwr.xml"), "utf-8");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (String(url).includes("robots.txt")) {
          return { ok: true, status: 200, text: async () => "" };
        }
        return { ok: true, status: 200, text: async () => xml };
      })
    );

    const scraper = new WeWorkRemotelyScraper("bot@example.com");
    const postings = await scraper.fetch(5);
    expect(postings.length).toBeGreaterThan(0);
    expect(postings[0].source).toBe("weworkremotely");
    expect(postings[0].description).toContain("jobs@designco.io");
  });

  it("parses HN hiring thread fixture", async () => {
    const thread = readFileSync(join(fixtures, "hn-thread.json"), "utf-8");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (String(url).includes("search")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ hits: [{ objectID: "999" }] }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => JSON.parse(thread),
        };
      })
    );

    const scraper = new HnHiringScraper("bot@example.com");
    const postings = await scraper.fetch(5);
    expect(postings[0].source).toBe("hn");
    expect(postings[0].description).toContain("hiring@acme.com");
  });

  it("blocks LinkedIn URLs", () => {
    expect(() => assertAllowedUrl("https://www.linkedin.com/jobs/1")).toThrow(
      /Blocked domain/
    );
  });
});
