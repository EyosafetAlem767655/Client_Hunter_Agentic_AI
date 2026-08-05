import { beforeEach, describe, expect, it, vi } from "vitest";

const queue = vi.hoisted(() => ({
  claimNextIndeedScrape: vi.fn(),
  getIndeedScrapeJob: vi.fn(),
}));

vi.mock("@/lib/indeed-queue", () => queue);

describe("Indeed worker queue routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 204 when a worker has no queued job", async () => {
    queue.claimNextIndeedScrape.mockResolvedValue(null);
    const { GET } = await import("@/app/api/worker/indeed/next/route");
    const response = await GET(
      new Request("http://localhost/api/worker/indeed/next?workerId=pc-1", {
        headers: { Authorization: "Bearer test-admin-token" },
      })
    );
    expect(response.status).toBe(204);
    expect(queue.claimNextIndeedScrape).toHaveBeenCalledWith("pc-1");
  });

  it("returns a claimed queue job to the local worker", async () => {
    queue.claimNextIndeedScrape.mockResolvedValue({
      id: 7,
      query: "software engineer remote",
      requestedAt: new Date("2026-08-05T00:00:00Z"),
    });
    const { GET } = await import("@/app/api/worker/indeed/next/route");
    const response = await GET(
      new Request("http://localhost/api/worker/indeed/next?workerId=pc-1", {
        headers: { Authorization: "Bearer test-admin-token" },
      })
    );
    expect(response.status).toBe(200);
    expect((await response.json()).job).toMatchObject({ id: 7 });
  });

  it("reports queue status to the authenticated Settings page", async () => {
    queue.getIndeedScrapeJob.mockResolvedValue({
      id: 7,
      status: "completed",
      fetched: 45,
      inserted: 40,
      error: null,
    });
    const { GET } = await import("@/app/api/manual/scrape/indeed/[id]/route");
    const response = await GET(
      new Request("http://localhost/api/manual/scrape/indeed/7", {
        headers: { Authorization: "Bearer test-admin-token" },
      }),
      { params: { id: "7" } }
    );
    expect(await response.json()).toMatchObject({
      ok: true,
      status: "completed",
      count: 45,
      inserted: 40,
    });
  });
});
