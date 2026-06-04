import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/scraper/node-runner", () => ({
  runNodeScrapers: vi.fn().mockResolvedValue({
    postings: [
      {
        source: "remoteok",
        externalId: "1",
        url: "https://example.com/1",
        title: "Virtual Assistant",
        company: "Acme",
        location: "US Remote",
        description: "We need a virtual assistant for calendar management. US-based.",
        postedAt: null,
        raw: {},
      },
      {
        source: "remoteok",
        externalId: "2",
        url: "https://example.com/2",
        title: "Senior Rust Engineer",
        company: "Acme",
        location: "Remote",
        description: "Hardcore systems work.",
        postedAt: null,
        raw: {},
      },
    ],
    scraped: 2,
    sources: [{ source: "remoteok", ok: true, count: 2 }],
  }),
}));

vi.mock("@/lib/scraper/python-client", () => ({
  runPythonScrapers: vi.fn(),
}));

vi.mock("@/lib/agent/memory", () => ({
  filterNewPostings: vi.fn(async (postings: unknown[]) => postings),
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

  it("uses Node scrapers, filters down to VA roles, and persists only VA postings", async () => {
    const { runPerception } = await import("@/lib/agent/perception");
    const result = await runPerception(10);
    // Only the VA posting should pass the VA filter
    expect(result.scraped).toBe(1);
    expect(result.inserted).toBe(1);
    expect(result.engine).toBe("node");
    expect(result.sources).toHaveLength(1);
  });
});
