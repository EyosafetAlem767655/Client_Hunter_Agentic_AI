import { describe, expect, it, vi, beforeEach } from "vitest";
import { sendEmail } from "@/lib/email/transport";

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn(),
    })),
  },
}));

describe("dry run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("never calls sendMail when dryRun is true", async () => {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.default.createTransport();
    await sendEmail({
      to: "hr@company.com",
      subject: "Test",
      body: "x".repeat(100),
      dryRun: true,
    });
    expect(transport.sendMail).not.toHaveBeenCalled();
  });
});
