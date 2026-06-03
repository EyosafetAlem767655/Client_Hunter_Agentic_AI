import { describe, expect, it, vi, beforeEach } from "vitest";
import { checkDomainRateLimit } from "@/lib/agent/guardrails";
import * as queries from "@/lib/db/queries";

vi.mock("@/lib/db/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof queries>();
  return {
    ...actual,
    countDomainSendsInWindow: vi.fn(),
    isSuppressed: vi.fn().mockResolvedValue(false),
    countEmailsSentToday: vi.fn().mockResolvedValue(0),
  };
});

describe("rate limiting", () => {
  beforeEach(() => {
    vi.mocked(queries.countDomainSendsInWindow).mockReset();
  });

  it("blocks when domain already contacted in window", async () => {
    vi.mocked(queries.countDomainSendsInWindow).mockResolvedValue(1);
    const result = await checkDomainRateLimit("hr@acme.com");
    expect(result.ok).toBe(false);
  });

  it("allows first send to domain", async () => {
    vi.mocked(queries.countDomainSendsInWindow).mockResolvedValue(0);
    const result = await checkDomainRateLimit("hr@acme.com");
    expect(result.ok).toBe(true);
  });

  it("simulates burst: only first of 100 passes when counter increments", async () => {
    let count = 0;
    vi.mocked(queries.countDomainSendsInWindow).mockImplementation(async () => {
      return count++;
    });

    let successes = 0;
    for (let i = 0; i < 100; i++) {
      const r = await checkDomainRateLimit("hr@samecorp.com");
      if (r.ok) successes++;
    }
    expect(successes).toBe(1);
  });
});
