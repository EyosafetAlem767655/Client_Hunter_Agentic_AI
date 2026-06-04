import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/llm/client", () => ({
  callOpenAIJson: vi.fn().mockResolvedValue({
    results: [
      {
        postingIndex: 0,
        job: {
          isRelevant: true,
          score: 90,
          roleCategory: "engineering",
          fitReason: "Great",
          suggestedRegions: ["PH"],
          estimatedSalaryRange: "$100k",
        },
      },
    ],
  }),
}));

vi.mock("@/lib/agent/memory", () => ({
  memory: {
    listUnfilteredPostings: vi.fn().mockResolvedValue([
      {
        posting: {
          id: 1,
          title: "Eng",
          company: "Acme",
          location: "Remote",
          description: "Build things",
        },
      },
    ]),
    getCachedLlm: vi.fn().mockResolvedValue(null),
    setCachedLlm: vi.fn().mockResolvedValue(undefined),
    insertFilteredJob: vi.fn().mockResolvedValue({ id: 1 }),
  },
}));

vi.mock("@/lib/agent/observability", () => ({
  logEvent: vi.fn().mockResolvedValue(undefined),
}));

describe("reasoning agent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters pending postings via LLM", async () => {
    const { filterPendingPostings } = await import("@/lib/agent/reasoning");
    const result = await filterPendingPostings(5);
    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);
  }, 15_000);
});
