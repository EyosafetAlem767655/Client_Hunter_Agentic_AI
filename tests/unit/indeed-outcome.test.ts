import { describe, expect, it } from "vitest";
import { describeIndeedOutcome } from "@/lib/scraper/indeed-outcome";

describe("describeIndeedOutcome", () => {
  it("refuses on Vercel regardless of reason", () => {
    const out = describeIndeedOutcome({ reason: "no_results", onVercel: true });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/Run the app locally/);
  });

  it("reports a timeout with the budget in seconds", () => {
    const out = describeIndeedOutcome({ timedOut: true, timeoutMs: 90_000 });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("timed out after 90s");
  });

  it("treats a cleared check with no jobs as success", () => {
    expect(describeIndeedOutcome({ reason: "no_results" })).toEqual({ ok: true });
  });

  it("explains a browser launch failure and includes the stderr tail", () => {
    const out = describeIndeedOutcome({
      reason: "browser_failed",
      stderrTail: "No usable browser found.",
    });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("Could not open a browser");
    expect(out.error).toContain("No usable browser found.");
  });

  it("omits the detail when stderr is empty", () => {
    const out = describeIndeedOutcome({ reason: "browser_failed", stderrTail: "  " });
    expect(out.error).toMatch(/Could not open a browser for Indeed\. Install/);
  });

  it("falls back to the 'check didn't clear' message", () => {
    for (const reason of ["challenge_not_cleared", "skipped", undefined]) {
      const out = describeIndeedOutcome({ reason });
      expect(out.ok).toBe(false);
      expect(out.error).toMatch(/Cloudflare check didn't clear/);
      expect(out.error).toContain("15 seconds");
    }
  });
});
