import { describe, expect, it, vi, beforeEach } from "vitest";

const ORIGINAL_KEY = process.env.GROK_API_KEY;

const upsertContact = vi.fn().mockResolvedValue({ id: 1 });
const discoverViaGrokBatch = vi.fn();

vi.mock("@/lib/llm/grok", () => ({
  isGrokConfigured: () => true,
}));

vi.mock("@/lib/contact/discovery", () => ({
  // Body lookup returns nothing so we go through Grok.
  discoverFromBody: vi.fn().mockReturnValue([]),
  discoverViaGrokBatch,
  // Fallback path returns nothing so we can isolate the batch behaviour.
  discoverContactsForPosting: vi.fn().mockResolvedValue([]),
  pickBestContact: vi.fn((c: Array<{ confidence: number }>) =>
    c.length ? c.sort((a, b) => b.confidence - a.confidence)[0] : null
  ),
}));

vi.mock("@/lib/agent/observability", () => ({
  logEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/agent/memory", () => ({
  memory: {
    listTopRelevantWithoutContacts: vi.fn(),
    upsertContact,
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function jobRow(id: number, company: string): any {
  return {
    posting: {
      id,
      title: `Role ${id}`,
      company,
      description: "",
      url: `https://example.com/${id}`,
    },
    filtered: { id, postingId: id, isRelevant: true, score: 80 },
  };
}

describe("discoverContactsForTopJobs (batched Grok)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GROK_API_KEY = "xai-test";
  });

  it("groups 12 pending jobs into 4 Grok calls of size 3 each and persists matches", async () => {
    const { memory } = await import("@/lib/agent/memory");
    const jobs = Array.from({ length: 12 }, (_, i) =>
      jobRow(i + 1, `Co${i + 1}`)
    );
    vi.mocked(memory.listTopRelevantWithoutContacts).mockResolvedValue(jobs);

    // Each call returns matches for the companies it received.
    discoverViaGrokBatch.mockImplementation(
      async (inputs: Array<{ company: string }>) => {
        const map = new Map<
          string,
          Array<{ email: string; sourceType: string; confidence: number }>
        >();
        for (const i of inputs) {
          map.set(i.company, [
            {
              email: `careers@${i.company.toLowerCase()}.com`,
              sourceType: "scraped_from_site",
              confidence: 0.9,
            },
          ]);
        }
        return map;
      }
    );

    const { discoverContactsForTopJobs } = await import("@/lib/agent/action");
    const n = await discoverContactsForTopJobs(50);

    // 12 jobs, batched in groups of 3 → 4 calls of size 3
    expect(discoverViaGrokBatch).toHaveBeenCalledTimes(4);
    const sizes = discoverViaGrokBatch.mock.calls
      .map((c) => c[0].length)
      .sort();
    expect(sizes).toEqual([3, 3, 3, 3]);

    // All 12 should have been persisted
    expect(upsertContact).toHaveBeenCalledTimes(12);
    expect(n).toBe(12);
  });

  it("falls back to per-posting chain for companies Grok didn't return", async () => {
    const { memory } = await import("@/lib/agent/memory");
    const { discoverContactsForPosting } = await import(
      "@/lib/contact/discovery"
    );
    vi.mocked(memory.listTopRelevantWithoutContacts).mockResolvedValue([
      jobRow(1, "GrokKnowsCo"),
      jobRow(2, "GrokMissedCo"),
    ]);
    discoverViaGrokBatch.mockResolvedValueOnce(
      new Map([
        [
          "GrokKnowsCo",
          [
            {
              email: "careers@grokknowsco.com",
              sourceType: "scraped_from_site",
              confidence: 0.92,
            },
          ],
        ],
      ])
    );
    vi.mocked(discoverContactsForPosting).mockResolvedValueOnce([
      {
        email: "fallback@grokmissedco.com",
        sourceType: "scraped_from_site",
        confidence: 0.7,
      },
    ]);

    const { discoverContactsForTopJobs } = await import("@/lib/agent/action");
    const n = await discoverContactsForTopJobs(10);
    expect(n).toBe(2);
    // Fallback was called once, with skipGrok=true so we don't double-pay.
    expect(discoverContactsForPosting).toHaveBeenCalledTimes(1);
    expect(discoverContactsForPosting).toHaveBeenCalledWith(
      expect.objectContaining({ company: "GrokMissedCo" }),
      { skipGrok: true }
    );
  });

  afterAll();
});

function afterAll() {
  // restore env at module-teardown
  if (ORIGINAL_KEY === undefined) {
    delete process.env.GROK_API_KEY;
  } else {
    process.env.GROK_API_KEY = ORIGINAL_KEY;
  }
}
