import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/llm/client", () => ({
  callOpenAIJson: vi.fn().mockResolvedValue({
    subject: "Talent partnership",
    body: "Hello from TalentBridge. " + "x".repeat(120),
  }),
}));

vi.mock("@/lib/email/transport", () => ({
  sendEmail: vi.fn().mockResolvedValue({ messageId: "<test@test>", dryRun: true }),
}));

vi.mock("@/lib/agent/guardrails", () => ({
  runAllGuardrails: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/lib/agent/observability", () => ({
  logEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/contact/discovery", () => ({
  discoverContactsForPosting: vi.fn().mockResolvedValue([
    { email: "hr@acme.com", sourceType: "listed", confidence: 0.9 },
  ]),
  pickBestContact: vi.fn((c: unknown[]) => c[0]),
}));

vi.mock("@/lib/agent/memory", () => ({
  memory: {
    listTopRelevantWithoutContacts: vi.fn().mockResolvedValue([
      {
        posting: {
          id: 2,
          description: "hi",
          url: "https://acme.com",
          company: "Acme",
          title: "Eng",
        },
      },
    ]),
    upsertContact: vi.fn().mockResolvedValue({ id: 1 }),
    listJobsNeedingDraft: vi.fn().mockResolvedValue([
      {
        contact: { id: 1, email: "hr@acme.com" },
        posting: {
          id: 1,
          title: "Engineer",
          company: "Acme",
        },
        filtered: {
          fitReason: "Strong fit",
          roleCategory: "engineering",
        },
      },
    ]),
    getCachedLlm: vi.fn().mockResolvedValue(null),
    setCachedLlm: vi.fn().mockResolvedValue(undefined),
    createOutreachEmail: vi.fn().mockResolvedValue({ id: 1 }),
    listPendingOutreach: vi.fn().mockResolvedValue([
      {
        email: {
          id: 1,
          subject: "Talent partnership",
          body: "x".repeat(150),
          status: "pending",
        },
        contact: { id: 1, email: "hr@acme.com", confidence: "0.9" },
        posting: { id: 1 },
      },
    ]),
    updateOutreachStatus: vi.fn().mockResolvedValue(undefined),
    recordDomainSend: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("action draft and send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("discovers contacts for top jobs", async () => {
    const { discoverContactsForTopJobs } = await import("@/lib/agent/action");
    const n = await discoverContactsForTopJobs(5);
    expect(n).toBe(1);
  });

  it("drafts emails for contacts", async () => {
    const { draftEmailsForContacts } = await import("@/lib/agent/action");
    const n = await draftEmailsForContacts(5, true);
    expect(n).toBe(1);
  });

  it("sends pending when guardrails pass", async () => {
    const { sendApprovedEmails } = await import("@/lib/agent/action");
    const { sendEmail } = await import("@/lib/email/transport");
    const result = await sendApprovedEmails(5, true, true);
    expect(result.sent).toBe(1);
    expect(sendEmail).toHaveBeenCalled();
  });

  it("increments failed when guardrails block", async () => {
    const { runAllGuardrails } = await import("@/lib/agent/guardrails");
    vi.mocked(runAllGuardrails).mockResolvedValueOnce({
      ok: false,
      reason: "blocked",
    });
    const { sendApprovedEmails } = await import("@/lib/agent/action");
    const result = await sendApprovedEmails(5, true, true);
    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);
  });
});
