import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/scraper/node-runner", () => ({
  runNodeScrapers: vi.fn().mockResolvedValue({
    postings: [
      {
        source: "remoteok",
        externalId: "1",
        url: "https://example.com/1",
        title: "Backend Developer",
        company: "Acme",
        location: "US Remote",
        description: "Build and scale our Node/TypeScript APIs. Fully remote.",
        postedAt: null,
        raw: {},
      },
      {
        source: "remoteok",
        externalId: "2",
        url: "https://example.com/2",
        title: "Registered Nurse",
        company: "ClearPath Health",
        location: "Remote",
        description: "Provide bedside patient care on our telehealth floor.",
        postedAt: null,
        raw: {},
      },
    ],
    scraped: 2,
    sources: [
      {
        source: "remoteok",
        label: "RemoteOK",
        ok: true,
        status: "scraped",
        count: 2,
      },
    ],
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

// ingestPostings reads existing title+company keys for near-duplicate dedup —
// stub it (no DB in unit tests); keep the real pure titleCompanyKey.
vi.mock("@/lib/db/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/queries")>();
  return { ...actual, getAllTitleCompanyKeys: vi.fn().mockResolvedValue(new Set<string>()) };
});

vi.mock("@/lib/agent/observability", () => ({
  logEvent: vi.fn().mockResolvedValue(undefined),
}));

describe("perception", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses Node scrapers, filters down to tech roles, and persists only tech postings", async () => {
    const { runPerception } = await import("@/lib/agent/perception");
    const result = await runPerception(10);
    // Only the developer posting should pass the tech pre-filter (the nurse is dropped)
    expect(result.scraped).toBe(1);
    expect(result.inserted).toBe(1);
    expect(result.engine).toBe("node");
    expect(result.sources).toHaveLength(1);
  });

  it("logs individual scraper HTTP failures as warnings, not pipeline errors", async () => {
    const nodeRunner = await import("@/lib/scraper/node-runner");
    const observability = await import("@/lib/agent/observability");
    vi.mocked(nodeRunner.runNodeScrapers).mockResolvedValueOnce({
      postings: [],
      scraped: 0,
      sources: [
        {
          source: "totaljobs",
          label: "Totaljobs",
          ok: false,
          status: "rejected",
          count: 0,
          error: "HTTP 500 for https://www.totaljobs.com/jobs/virtual-assistant",
        },
      ],
    });

    const { runPerception } = await import("@/lib/agent/perception");
    const result = await runPerception(10);

    expect(result.sources[0]).toMatchObject({
      source: "totaljobs",
      ok: false,
      status: "rejected",
    });
    expect(observability.logEvent).toHaveBeenCalledWith(
      "warn",
      "node scraper Totaljobs skipped",
      expect.objectContaining({
        source: "totaljobs",
        status: "rejected",
      })
    );
    expect(observability.logEvent).not.toHaveBeenCalledWith(
      "error",
      expect.stringContaining("Totaljobs"),
      expect.anything()
    );
  });
});
