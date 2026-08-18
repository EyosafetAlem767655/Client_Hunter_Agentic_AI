import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fallbackContactUrls } from "@/lib/contact/url-filter";

describe("fallbackContactUrls", () => {
  it("selects CRAE Group contact URL over similar-company results", () => {
    const out = fallbackContactUrls("CRAE GROUP LTD", [
      {
        title: "CRAE GROUP LTD - Contact Us",
        url: "https://www.craegroup.com/contact",
        displayUrl: "https://www.craegroup.com/contact",
        snippet: "Contact CRAE GROUP LTD for enquiries.",
        summary: "Official contact page.",
      },
      {
        title: "CRA Group Jobs",
        url: "https://jobs.cra-group.example/contact",
        displayUrl: "jobs.cra-group.example/contact",
        snippet: "Open jobs at a similarly named company.",
        summary: "",
      },
      {
        title: "LinkedIn CRAE Group",
        url: "https://www.linkedin.com/company/crae-group",
        displayUrl: "linkedin.com/company/crae-group",
        snippet: "Social profile.",
        summary: "",
      },
      {
        title: "Craegroup Home",
        url: "https://www.craegroup.com/",
        displayUrl: "craegroup.com",
        snippet: "Official website.",
        summary: "",
      },
    ]);

    expect(out[0]).toBe("https://www.craegroup.com/contact");
    expect(out).not.toContain("https://www.linkedin.com/company/crae-group");
  });
});

const llmMocks = vi.hoisted(() => ({
  callGeminiJson: vi.fn(),
}));

vi.mock("@/lib/llm/client", () => ({
  callGeminiJson: llmMocks.callGeminiJson,
}));

vi.mock("@/lib/agent/observability", () => ({
  logEvent: vi.fn().mockResolvedValue(undefined),
}));

describe("filterContactUrls — keyword pre-filter + hallucination guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips the LLM when no candidate mentions a contact keyword", async () => {
    const { filterContactUrls } = await import("@/lib/contact/url-filter");
    await filterContactUrls("Foo Corp", [
      {
        title: "Foo Corp investor day",
        url: "https://foocorp.com/investors",
        displayUrl: "foocorp.com/investors",
        snippet: "Annual investor day announcement",
        summary: "",
      },
    ]);
    expect(llmMocks.callGeminiJson).not.toHaveBeenCalled();
  });

  it("only sends keyword-matching candidates to the LLM", async () => {
    llmMocks.callGeminiJson.mockResolvedValue({
      url: "https://acme.com/contact",
    });
    const { filterContactUrls } = await import("@/lib/contact/url-filter");

    await filterContactUrls("Acme", [
      {
        title: "Acme Contact",
        url: "https://acme.com/contact",
        displayUrl: "acme.com/contact",
        snippet: "Reach out via our contact page.",
        summary: "",
      },
      {
        title: "Acme Annual Report",
        url: "https://acme.com/reports/2025",
        displayUrl: "acme.com/reports/2025",
        snippet: "Annual financial filing.",
        summary: "",
      },
    ]);

    expect(llmMocks.callGeminiJson).toHaveBeenCalledTimes(1);
    const call = llmMocks.callGeminiJson.mock.calls[0][0];
    expect(call.user).toContain("https://acme.com/contact");
    expect(call.user).not.toContain("https://acme.com/reports/2025");
  });

  it("rejects an LLM-invented URL that wasn't in the allowed set", async () => {
    llmMocks.callGeminiJson.mockResolvedValue({
      url: "https://attacker.example/phishing",
    });
    const { filterContactUrls } = await import("@/lib/contact/url-filter");

    const out = await filterContactUrls("Acme", [
      {
        title: "Acme Contact",
        url: "https://acme.com/contact",
        displayUrl: "acme.com/contact",
        snippet: "Contact Acme",
        summary: "",
      },
    ]);

    expect(out).not.toContain("https://attacker.example/phishing");
    expect(out).toContain("https://acme.com/contact");
  });

  it("returns the LLM pick when it is in the allowed set", async () => {
    llmMocks.callGeminiJson.mockResolvedValue({
      url: "https://acme.com/contact",
    });
    const { filterContactUrls } = await import("@/lib/contact/url-filter");

    const out = await filterContactUrls("Acme", [
      {
        title: "Acme Contact",
        url: "https://acme.com/contact",
        displayUrl: "acme.com/contact",
        snippet: "Contact Acme",
        summary: "",
      },
      {
        title: "Acme Apply",
        url: "https://acme.com/apply",
        displayUrl: "acme.com/apply",
        snippet: "Apply at Acme",
        summary: "",
      },
    ]);

    expect(out).toEqual(["https://acme.com/contact"]);
  });
});
