import { describe, expect, it } from "vitest";
import { verifyCronAuth, verifyManualAuth, verifyWorkerAuth } from "@/lib/auth";

function request(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/cron/scrape", { headers });
}

describe("auth", () => {
  it("accepts Vercel cron header", () => {
    const prev = process.env.VERCEL;
    process.env.VERCEL = "1";
    expect(
      verifyCronAuth(
        request({
          "x-vercel-cron": "1",
        })
      )
    ).toBe(true);
    process.env.VERCEL = prev;
  });

  it("accepts bearer CRON_SECRET", () => {
    expect(
      verifyCronAuth(
        request({
          Authorization: "Bearer test-cron-secret",
        })
      )
    ).toBe(true);
  });

  it("accepts ADMIN_TOKEN for manual scrape", () => {
    expect(
      verifyManualAuth(
        request({
          Authorization: "Bearer test-admin-token",
        })
      )
    ).toBe(true);
  });

  it("rejects missing auth", () => {
    expect(verifyManualAuth(request({}))).toBe(false);
  });

  it("accepts ADMIN_TOKEN for a local worker", () => {
    expect(
      verifyWorkerAuth(request({ Authorization: "Bearer test-admin-token" }))
    ).toBe(true);
  });

  it("accepts a dedicated Indeed worker token", () => {
    const previous = process.env.INDEED_WORKER_TOKEN;
    process.env.INDEED_WORKER_TOKEN = "test-worker-token";
    expect(
      verifyWorkerAuth(request({ Authorization: "Bearer test-worker-token" }))
    ).toBe(true);
    if (previous === undefined) delete process.env.INDEED_WORKER_TOKEN;
    else process.env.INDEED_WORKER_TOKEN = previous;
  });
});
