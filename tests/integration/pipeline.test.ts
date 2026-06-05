import { describe, expect, it, vi, beforeEach } from "vitest";

const mockDb = {
  createAgentRun: vi.fn().mockResolvedValue({ id: 1 }),
  finishAgentRun: vi.fn().mockResolvedValue(undefined),
  insertAgentEvent: vi.fn().mockResolvedValue(undefined),
  upsertJobPosting: vi.fn().mockResolvedValue({ id: 1 }),
  getExistingExternalIds: vi.fn().mockResolvedValue(new Set()),
  listUnfilteredPostings: vi.fn().mockResolvedValue([]),
  insertFilteredJob: vi.fn().mockResolvedValue({ id: 1 }),
  listTopRelevantWithoutContacts: vi.fn().mockResolvedValue([]),
  listJobsNeedingDraft: vi.fn().mockResolvedValue([]),
  listPendingOutreach: vi.fn().mockResolvedValue([]),
  getSetting: vi.fn().mockResolvedValue("true"),
  getLlmCache: vi.fn().mockResolvedValue(null),
  setLlmCache: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@/lib/db/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/queries")>();
  return { ...actual, ...mockDb };
});
vi.mock("@/lib/agent/perception", () => ({
  runPerception: vi.fn().mockResolvedValue({ scraped: 2, inserted: 1, engine: "python" }),
  ingestPostings: vi.fn().mockResolvedValue({ scraped: 2, inserted: 1 }),
}));
vi.mock("@/lib/agent/reasoning", () => ({
  filterPendingPostings: vi
    .fn()
    .mockResolvedValue({ processed: 0, succeeded: 0, newMatches: [] }),
}));
vi.mock("@/lib/agent/action", () => ({
  discoverContactsForTopJobs: vi.fn().mockResolvedValue(0),
  draftEmailsForContacts: vi.fn().mockResolvedValue(0),
  sendApprovedEmails: vi.fn().mockResolvedValue({ sent: 0, failed: 0 }),
}));
vi.mock("@/lib/email/digest", () => ({
  sendDailyDigest: vi
    .fn()
    .mockResolvedValue({ sent: false, count: 0, dryRun: true }),
  sendInstantVaAlert: vi
    .fn()
    .mockResolvedValue({ sent: false, count: 0, dryRun: true }),
}));

describe("pipeline integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs scrape pipeline end-to-end with mocks", async () => {
    const { runScrapePipeline } = await import("@/lib/agent/orchestrator");
    const action = await import("@/lib/agent/action");
    const summary = await runScrapePipeline();
    expect(summary.runId).toBe(1);
    expect(summary.succeeded).toBeGreaterThanOrEqual(0);
    expect(mockDb.finishAgentRun).toHaveBeenCalledWith(
      1,
      "completed",
      expect.objectContaining({
        perception: expect.objectContaining({ scraped: 2 }),
        drafted: 0,
        send: expect.objectContaining({ sent: 0, failed: 0 }),
      })
    );
    // The scrape pipeline now also runs draft + send so the user doesn't
    // have to wait for the 14:00 UTC outreach cron.
    expect(action.draftEmailsForContacts).toHaveBeenCalled();
    expect(action.sendApprovedEmails).toHaveBeenCalled();
  }, 15_000);

  it("runs outreach pipeline without sending in dry run", async () => {
    const { runOutreachPipeline } = await import("@/lib/agent/orchestrator");
    const { sendApprovedEmails } = await import("@/lib/agent/action");
    const summary = await runOutreachPipeline();
    expect(sendApprovedEmails).toHaveBeenCalledWith(
      expect.any(Number),
      true,
      expect.any(Boolean)
    );
    expect(summary.runId).toBe(1);
  });
});
