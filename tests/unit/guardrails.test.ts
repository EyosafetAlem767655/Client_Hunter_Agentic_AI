import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  checkBodyLength,
  checkPlaceholders,
  checkSubject,
  checkRecipientEmail,
  checkKillSwitch,
  checkLlmValidation,
  checkConfidence,
} from "@/lib/agent/guardrails";

vi.mock("@/lib/db/queries", () => ({
  isSuppressed: vi.fn().mockResolvedValue(false),
  countDomainSendsInWindow: vi.fn().mockResolvedValue(0),
  countEmailsSentToday: vi.fn().mockResolvedValue(0),
}));

describe("guardrails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts valid body length", () => {
    expect(checkBodyLength("x".repeat(150)).ok).toBe(true);
  });

  it("rejects short body", () => {
    expect(checkBodyLength("short").ok).toBe(false);
  });

  it("rejects unresolved placeholders", () => {
    expect(checkPlaceholders("Hello {{name}} there").ok).toBe(false);
  });

  it("rejects ALL CAPS subject", () => {
    expect(checkSubject("AMAZING JOB OFFER NOW").ok).toBe(false);
  });

  it("rejects banned phrases", () => {
    expect(checkSubject("URGENT hiring need").ok).toBe(false);
  });

  it("rejects personal email", () => {
    expect(checkRecipientEmail("user@gmail.com").ok).toBe(false);
  });

  it("accepts business email", () => {
    expect(checkRecipientEmail("hr@acmecorp.com").ok).toBe(true);
  });

  it("kill switch blocks when disabled", () => {
    expect(checkKillSwitch(false).ok).toBe(false);
  });

  it("validates LLM output with zod", () => {
    expect(
      checkLlmValidation({
        subject: "Partnership",
        body: "x".repeat(120),
      }).ok
    ).toBe(true);
  });

  it("blocks low confidence when not allowed", () => {
    expect(checkConfidence(0.3, false).ok).toBe(false);
  });
});
