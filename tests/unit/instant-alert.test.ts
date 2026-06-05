import { describe, expect, it, vi, beforeEach } from "vitest";

const sendMail = vi.fn().mockResolvedValue({});

vi.mock("@/lib/email/transport", () => ({
  createTransport: () => ({ sendMail }),
  generateMessageId: () => "<mid-1@test>",
}));

vi.mock("@/lib/agent/observability", () => ({
  logEvent: vi.fn().mockResolvedValue(undefined),
}));

const sample = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    postingId: i + 1,
    title: `Virtual Assistant ${i + 1}`,
    company: "Acme",
    location: "USA",
    url: `https://example.com/${i + 1}`,
    score: 90 - i,
    roleCategory: "virtual_assistant",
    fitReason: "VA duties at a US employer.",
    estimatedSalaryRange: "$15-$25/hr",
  }));

describe("sendInstantVaAlert", () => {
  beforeEach(() => {
    sendMail.mockClear();
  });

  it("is a no-op when there are zero new matches", async () => {
    const { sendInstantVaAlert } = await import("@/lib/email/digest");
    const r = await sendInstantVaAlert([], { dryRun: false });
    expect(r.sent).toBe(false);
    expect(r.count).toBe(0);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("does not call SMTP in dry-run mode", async () => {
    const { sendInstantVaAlert } = await import("@/lib/email/digest");
    const r = await sendInstantVaAlert(sample(2), { dryRun: true });
    expect(r.sent).toBe(false);
    expect(r.dryRun).toBe(true);
    expect(r.count).toBe(2);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("sends a structured alert email with all new matches", async () => {
    const { sendInstantVaAlert } = await import("@/lib/email/digest");
    const r = await sendInstantVaAlert(sample(3), { dryRun: false });
    expect(r.sent).toBe(true);
    expect(r.count).toBe(3);
    expect(sendMail).toHaveBeenCalledTimes(1);

    const call = sendMail.mock.calls[0][0];
    expect(call.subject).toMatch(/3 new VA-similar/);
    expect(call.html).toContain("Virtual Assistant 1");
    expect(call.html).toContain("Virtual Assistant 3");
    expect(call.text).toContain("https://example.com/1");
  });

  it("returns sent=false but does not throw on SMTP error", async () => {
    sendMail.mockRejectedValueOnce(new Error("smtp down"));
    const { sendInstantVaAlert } = await import("@/lib/email/digest");
    const r = await sendInstantVaAlert(sample(1), { dryRun: false });
    expect(r.sent).toBe(false);
    expect(r.count).toBe(1);
  });
});
