import { describe, expect, it, vi, beforeEach } from "vitest";
import { runAllGuardrails } from "@/lib/agent/guardrails";

vi.mock("@/lib/db/queries", () => ({
  isSuppressed: vi.fn().mockResolvedValue(false),
  countDomainSendsInWindow: vi.fn().mockResolvedValue(0),
  countEmailsSentToday: vi.fn().mockResolvedValue(0),
}));

describe("runAllGuardrails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes valid send context", async () => {
    const result = await runAllGuardrails({
      recipientEmail: "hr@acme.com",
      subject: "Partnership opportunity",
      body: "x".repeat(150),
      llmOutput: { subject: "Hi", body: "x".repeat(150) },
      agentEnabled: true,
      dryRun: true,
      confidence: 0.9,
    });
    expect(result.ok).toBe(true);
  });

  it("fails when agent disabled", async () => {
    const result = await runAllGuardrails({
      recipientEmail: "hr@acme.com",
      subject: "Hello",
      body: "x".repeat(150),
      llmOutput: { subject: "Hello", body: "x".repeat(150) },
      agentEnabled: false,
      dryRun: true,
    });
    expect(result.ok).toBe(false);
  });
});
