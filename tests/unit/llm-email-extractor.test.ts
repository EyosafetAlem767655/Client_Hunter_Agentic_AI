import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScrapedContactPage } from "@/lib/contact/python-scraper";

const llmMocks = vi.hoisted(() => ({
  callGeminiJson: vi.fn(),
}));

vi.mock("@/lib/llm/client", () => ({
  callGeminiJson: llmMocks.callGeminiJson,
}));

vi.mock("@/lib/agent/observability", () => ({
  logEvent: vi.fn().mockResolvedValue(undefined),
}));

function page(overrides: Partial<ScrapedContactPage> = {}): ScrapedContactPage {
  return {
    url: "https://acme.com/contact",
    text: "",
    mailtos: [],
    elements: [],
    engine: "requests",
    ok: true,
    ...overrides,
  };
}

describe("collectEmailSnippets — @-aware pre-filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("extracts every @-containing sentence and every regex email", async () => {
    const { collectEmailSnippets } = await import(
      "@/lib/contact/llm-email-extractor"
    );
    const snippets = collectEmailSnippets(
      page({
        text:
          "About us. We make widgets. Contact us at hr@acme.com for hiring. " +
          "General: hello@acme.com. Investor relations is closed.",
        mailtos: ["hr@acme.com", "hello@acme.com"],
      })
    );

    expect(snippets.rawEmails.sort()).toEqual(
      ["hello@acme.com", "hr@acme.com"]
    );
    // Every snippet has @.
    expect(snippets.snippets.length).toBeGreaterThan(0);
    for (const snippet of snippets.snippets) {
      expect(snippet).toContain("@");
    }
    // Sentences without @ are dropped.
    expect(snippets.snippets.some((s) => s.includes("About us"))).toBe(false);
    expect(
      snippets.snippets.some((s) => s.includes("Investor relations"))
    ).toBe(false);
  });

  it("pulls @ values out of DOM element attributes", async () => {
    const { collectEmailSnippets } = await import(
      "@/lib/contact/llm-email-extractor"
    );
    const snippets = collectEmailSnippets(
      page({
        text: "Reach us",
        elements: [
          {
            tag: "a",
            attributes: { href: "mailto:careers@acme.com" },
            text: "careers@acme.com",
          },
          {
            tag: "div",
            attributes: { class: ["footer"] },
            text: "Nothing useful here",
          },
        ],
      })
    );
    expect(snippets.rawEmails).toContain("careers@acme.com");
  });

  it("returns no snippets when nothing contains @", async () => {
    const { collectEmailSnippets } = await import(
      "@/lib/contact/llm-email-extractor"
    );
    const snippets = collectEmailSnippets(
      page({
        text: "We have no email on this page. Use the contact form.",
        elements: [
          { tag: "p", attributes: {}, text: "Form below" },
        ],
      })
    );
    expect(snippets.snippets).toEqual([]);
    expect(snippets.rawEmails).toEqual([]);
  });
});

describe("extractEmailsFromPages — only sends @ snippets to LLM", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips the LLM entirely when no page has @", async () => {
    const { extractEmailsFromPages } = await import(
      "@/lib/contact/llm-email-extractor"
    );
    const out = await extractEmailsFromPages([
      page({ text: "Contact form only — no email visible." }),
    ]);
    expect(out).toEqual([]);
    expect(llmMocks.callGeminiJson).not.toHaveBeenCalled();
  });

  it("sends only @-containing snippets, then validates LLM picks against the regex set", async () => {
    llmMocks.callGeminiJson.mockResolvedValue({
      primary: "hr@acme.com",
      alternates: ["hello@acme.com"],
    });
    const { extractEmailsFromPages } = await import(
      "@/lib/contact/llm-email-extractor"
    );
    const out = await extractEmailsFromPages([
      page({
        text: "Our office. Reach hr@acme.com for hiring. Also hello@acme.com.",
        mailtos: ["hr@acme.com", "hello@acme.com"],
      }),
    ]);

    expect(llmMocks.callGeminiJson).toHaveBeenCalledTimes(1);
    const call = llmMocks.callGeminiJson.mock.calls[0][0];
    // Prompt mentions @-containing sentences.
    expect(call.user).toContain("hr@acme.com");
    // But NOT unrelated sentences.
    expect(call.user).not.toContain("Our office");

    expect(out).toContain("hr@acme.com");
    expect(out).toContain("hello@acme.com");
  });

  it("rejects an LLM-invented email and falls back to the regex set", async () => {
    llmMocks.callGeminiJson.mockResolvedValue({
      primary: "phisher@evil.test",
      alternates: [],
    });
    const { extractEmailsFromPages } = await import(
      "@/lib/contact/llm-email-extractor"
    );
    const out = await extractEmailsFromPages([
      page({
        text: "Email hello@acme.com",
        mailtos: ["hello@acme.com"],
      }),
    ]);
    expect(out).not.toContain("phisher@evil.test");
    expect(out).toContain("hello@acme.com");
  });

  it("returns regex-matched emails when the LLM call throws", async () => {
    llmMocks.callGeminiJson.mockRejectedValue(new Error("Gemini timeout"));
    const { extractEmailsFromPages } = await import(
      "@/lib/contact/llm-email-extractor"
    );
    const out = await extractEmailsFromPages([
      page({
        text: "Reach careers@acme.com",
        mailtos: ["careers@acme.com"],
      }),
    ]);
    expect(out).toContain("careers@acme.com");
  });
});
