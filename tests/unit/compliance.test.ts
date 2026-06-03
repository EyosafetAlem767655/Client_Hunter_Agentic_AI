import { describe, expect, it } from "vitest";
import { buildListUnsubscribeHeaders } from "@/lib/email/compliance";
import { finalizeEmailBody, buildEmailFooter } from "@/lib/email/templates";
import { env } from "@/lib/env";

describe("compliance", () => {
  it("includes unsubscribe headers", () => {
    const headers = buildListUnsubscribeHeaders();
    expect(headers["List-Unsubscribe"]).toContain(env.UNSUBSCRIBE_MAILTO);
    expect(headers["List-Unsubscribe"]).toContain(env.UNSUBSCRIBE_URL);
    expect(headers["List-Unsubscribe-Post"]).toBeTruthy();
  });

  it("footer includes business name and address", () => {
    const footer = buildEmailFooter();
    expect(footer).toContain(env.BUSINESS_NAME);
    expect(footer).toContain(env.BUSINESS_ADDRESS);
    expect(footer).toContain(env.UNSUBSCRIBE_URL);
  });

  it("finalized email replaces placeholders", () => {
    const body = finalizeEmailBody(
      "Hello\n{{BUSINESS_NAME}}\n{{BUSINESS_ADDRESS}}\n{{UNSUBSCRIBE_URL}}"
    );
    expect(body).toContain(env.BUSINESS_NAME);
    expect(body).not.toContain("{{BUSINESS_NAME}}");
  });
});
