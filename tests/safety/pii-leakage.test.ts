import { describe, expect, it, vi } from "vitest";
import { logEvent } from "@/lib/agent/observability";

vi.mock("@/lib/db/queries", () => ({
  insertAgentEvent: vi.fn().mockResolvedValue(undefined),
}));

describe("PII leakage", () => {
  it("redacts secrets from log context", async () => {
    const logs: unknown[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(...args);
    };

    await logEvent("info", "test event", {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD,
      safeField: "visible",
    });

    console.log = origLog;
    const joined = JSON.stringify(logs);
    expect(joined).not.toContain(process.env.GMAIL_APP_PASSWORD);
    expect(joined).toContain("[REDACTED]");
  });
});
