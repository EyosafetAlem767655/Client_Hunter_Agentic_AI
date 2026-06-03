import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/scrapers", () => ({
  getEnabledScrapers: vi.fn(() => [
    {
      source: "remoteok",
      fetch: vi.fn().mockResolvedValue([
        {
          source: "remoteok",
          externalId: "1",
          url: "https://example.com/1",
          title: "Dev",
          company: "Co",
          location: "Remote",
          description: "hi",
          postedAt: null,
          raw: {},
        },
      ]),
    },
    {
      source: "hn",
      fetch: vi.fn().mockRejectedValue(new Error("HTTP 429")),
    },
  ]),
}));

vi.mock("@/lib/agent/memory", () => ({
  filterNewPostings: vi.fn().mockResolvedValue([
    {
      source: "remoteok",
      externalId: "1",
      url: "https://example.com/1",
      title: "Dev",
      company: "Co",
      location: "Remote",
      description: "hi",
      postedAt: null,
      raw: {},
    },
  ]),
  memory: {
    upsertJobPosting: vi.fn().mockResolvedValue({ id: 1 }),
  },
}));

vi.mock("@/lib/agent/observability", () => ({
  logEvent: vi.fn().mockResolvedValue(undefined),
}));

describe("perception", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("aggregates scrapers and persists novel postings", async () => {
    const { runPerception } = await import("@/lib/agent/perception");
    const result = await runPerception(10);
    expect(result.scraped).toBe(1);
    expect(result.inserted).toBe(1);
  });
});
