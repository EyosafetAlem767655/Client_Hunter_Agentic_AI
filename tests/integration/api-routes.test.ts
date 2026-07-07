import { describe, expect, it, vi, beforeEach } from "vitest";
vi.mock("@/lib/agent/orchestrator", () => ({
  runScrapePipeline: vi.fn().mockResolvedValue({
    runId: 1,
    processed: 1,
    succeeded: 1,
    failed: 0,
    durationMs: 100,
  }),
  runOutreachPipeline: vi.fn().mockResolvedValue({
    runId: 2,
    processed: 1,
    succeeded: 1,
    failed: 0,
    durationMs: 100,
  }),
  runScrapePipelineForSource: vi.fn().mockResolvedValue({
    scraped: 5,
    inserted: 3,
    filtered: 1,
  }),
}));

vi.mock("@/lib/agent/memory", () => ({
  memory: {
    getSetting: vi.fn().mockResolvedValue(null),
    setSetting: vi.fn().mockResolvedValue(undefined),
    createAgentRun: vi.fn().mockResolvedValue({ id: 1 }),
    finishAgentRun: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/lib/email/digest", () => ({
  sendDailyDigest: vi.fn().mockResolvedValue({ sent: false, count: 0, dryRun: true }),
  sendInstantVaAlert: vi.fn().mockResolvedValue({ sent: false, count: 0, dryRun: true }),
}));

vi.mock("@/lib/db", () => ({
  healthCheck: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/db/queries", () => ({
  getLastSuccessfulRunAt: vi.fn().mockResolvedValue(new Date()),
  getDashboardStats: vi.fn().mockResolvedValue({
    scraped: 1,
    relevant: 1,
    contactsFound: 0,
    drafted: 0,
    sent: 0,
    replied: 0,
  }),
  getEmailsSentPerDay: vi.fn().mockResolvedValue([]),
  listRecentEvents: vi.fn().mockResolvedValue([]),
}));

describe("API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("health returns ok shape", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    const json = await res.json();
    expect(json).toHaveProperty("dbConnected");
    expect(json).toHaveProperty("hasDatabaseUrl");
  });

  it("cron scrape rejects bad auth", async () => {
    const { GET } = await import("@/app/api/cron/scrape/route");
    const res = await GET(
      new Request("http://localhost/api/cron/scrape", {
        headers: { Authorization: "Bearer wrong" },
      })
    );
    expect(res.status).toBe(401);
  });

  it("cron scrape accepts Vercel cron header", async () => {
    const prev = process.env.VERCEL;
    process.env.VERCEL = "1";
    const { GET } = await import("@/app/api/cron/scrape/route");
    const res = await GET(
      new Request("http://localhost/api/cron/scrape", {
        headers: { "x-vercel-cron": "1" },
      })
    );
    process.env.VERCEL = prev;
    expect(res.status).toBe(200);
  });

  it("cron scrape accepts valid auth", async () => {
    const { GET } = await import("@/app/api/cron/scrape/route");
    const res = await GET(
      new Request("http://localhost/api/cron/scrape", {
        headers: { Authorization: "Bearer test-cron-secret" },
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty("linkedin");
  });

  it("manual scrape rejects without admin token", async () => {
    const { POST } = await import("@/app/api/manual/scrape/route");
    const res = await POST(
      new Request("http://localhost/api/manual/scrape", { method: "POST" })
    );
    expect(res.status).toBe(401);
  });
});
