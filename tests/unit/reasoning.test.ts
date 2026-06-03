import { describe, expect, it } from "vitest";
import {
  parseFilteredBatch,
  FALLBACK_FILTERED,
} from "@/lib/llm/schemas";
import { FilteredJobSchema } from "@/lib/llm/schemas";

describe("reasoning / LLM parsing", () => {
  it("parses valid batch", () => {
    const raw = {
      results: [
        {
          postingIndex: 0,
          job: {
            isRelevant: true,
            score: 85,
            roleCategory: "engineering",
            fitReason: "Strong fit",
            suggestedRegions: ["PH", "IN"],
            estimatedSalaryRange: "$80k-$120k",
          },
        },
      ],
    };
    const parsed = parseFilteredBatch(raw);
    expect(parsed?.results[0].job.score).toBe(85);
  });

  it("returns null on malformed JSON shape", () => {
    expect(parseFilteredBatch({ foo: "bar" })).toBeNull();
    expect(parseFilteredBatch(null)).toBeNull();
  });

  it("rejects wrong types", () => {
    const raw = {
      results: [
        {
          postingIndex: 0,
          job: {
            isRelevant: "yes",
            score: "high",
            roleCategory: 1,
            fitReason: true,
            suggestedRegions: "PH",
            estimatedSalaryRange: 100,
          },
        },
      ],
    };
    expect(parseFilteredBatch(raw)).toBeNull();
  });

  it("fallback filtered job is not relevant score 0", () => {
    expect(FALLBACK_FILTERED.isRelevant).toBe(false);
    expect(FALLBACK_FILTERED.score).toBe(0);
  });

  it("validates single job schema", () => {
    const result = FilteredJobSchema.safeParse({
      isRelevant: true,
      score: 50,
      roleCategory: "support",
      fitReason: "ok",
      suggestedRegions: [],
      estimatedSalaryRange: "unknown",
    });
    expect(result.success).toBe(true);
  });
});
