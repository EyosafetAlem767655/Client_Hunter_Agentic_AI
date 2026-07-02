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
    getFeedbackExamples: vi.fn().mockResolvedValue([]),
    getSetting: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("@/lib/agent/observability", () => ({
  logEvent: vi.fn().mockResolvedValue(undefined),
}));

describe("reasoning agent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters pending postings via LLM and surfaces new VA matches", async () => {
    const { filterPendingPostings } = await import("@/lib/agent/reasoning");
    const result = await filterPendingPostings(5);
    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.newMatches).toHaveLength(1);
    expect(result.newMatches[0].postingId).toBe(1);
    expect(result.newMatches[0].score).toBe(90);
  }, 15_000);

  it("leaves postings unfiltered when the LLM filter call fails", async () => {
    const { callOpenAIJson } = await import("@/lib/llm/client");
    const { memory } = await import("@/lib/agent/memory");
    vi.mocked(callOpenAIJson).mockRejectedValueOnce(new Error("timeout"));

    const { filterPendingPostings } = await import("@/lib/agent/reasoning");
    const result = await filterPendingPostings(5, {
      llmMaxRetries: 1,
      llmTimeoutMs: 1_000,
    });

    expect(result.processed).toBe(0);
    expect(result.succeeded).toBe(0);
    expect(memory.insertFilteredJob).not.toHaveBeenCalled();
  }, 15_000);
});
