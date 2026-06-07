import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_KEY = process.env.GROK_API_KEY;

function mockGrokResponse(content: object, citations: string[] = []) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(content) } }],
      citations,
    }),
    text: async () => "",
  };
}

// Grok URL discovery → Python DOM scrape → OpenAI email extraction.
// `fetch` is stubbed only for the xAI call; the Python scraper and the
// OpenAI extractor are mocked at the module level so the test asserts
// on the orchestration (URL flows in, emails flow out) not on HTTP plumbing.

vi.mock("@/lib/contact/python-scraper", () => ({
  scrapeContactPages: vi.fn(),
}));

vi.mock("@/lib/contact/llm-email-extractor", () => ({
  extractEmailsFromPages: vi.fn(),
}));

async function loadMocks() {
  const py = await import("@/lib/contact/python-scraper");
  const llm = await import("@/lib/contact/llm-email-extractor");
  return {
    scrapeContactPages: vi.mocked(py.scrapeContactPages),
    extractEmailsFromPages: vi.mocked(llm.extractEmailsFromPages),
  };
}

describe("discoverViaGrok (Grok URL → Python DOM → OpenAI extract)", () => {
  beforeEach(() => {
    process.env.GROK_API_KEY = "xai-test-key";
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) {
      delete process.env.GROK_API_KEY;
    } else {
      process.env.GROK_API_KEY = ORIGINAL_KEY;
    }
    vi.restoreAllMocks();
  });

  it("asks Grok for the contact_url, scrapes via Python, lets OpenAI pick emails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockGrokResponse({
        contact_url: "https://acmestartup.io/contact",
        url: "https://acmestartup.io",
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { scrapeContactPages, extractEmailsFromPages } = await loadMocks();
    scrapeContactPages.mockResolvedValue({
      results: [
        {
          url: "https://acmestartup.io/contact",
          text: "Contact our team at careers@acmestartup.io",
          mailtos: ["careers@acmestartup.io"],
          engine: "playwright",
          ok: true,
        },
      ],
      engine_available: "playwright",
    });
    extractEmailsFromPages.mockResolvedValue([
      "careers@acmestartup.io",
      "hello@acmestartup.io",
    ]);

    const { discoverViaGrok } = await import("@/lib/contact/discovery");
    const out = await discoverViaGrok("AcmeStartup", {
      url: "https://acmestartup.io/jobs/1",
    });

    expect(out[0].email).toBe("careers@acmestartup.io");
    expect(out[0].sourceType).toBe("scraped_from_site");
    const alt = out.find((c) => c.email === "hello@acmestartup.io");
    expect(alt?.confidence).toBeLessThan(out[0].confidence);

    // The Grok prompt MUST be asking for the contact page URL, not the email.
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const userMsg = body.messages[1].content;
    expect(userMsg).toContain('"Contact us"');
    expect(userMsg).toContain("contact_url");
    expect(userMsg).not.toContain("the email for");

    // The contact_url MUST be the one sent to the Python scraper, ahead of
    // the homepage — otherwise we'd waste time scraping the wrong page first.
    const sentUrls = scrapeContactPages.mock.calls[0][0];
    expect(sentUrls[0]).toBe("https://acmestartup.io/contact");
  });

  it("returns [] when Grok produces no URL and no citations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockGrokResponse({ contact_url: null, url: null })
      )
    );
    const { scrapeContactPages } = await loadMocks();
    const { discoverViaGrok } = await import("@/lib/contact/discovery");
    const out = await discoverViaGrok("DefunctCo");
    expect(out).toEqual([]);
    expect(scrapeContactPages).not.toHaveBeenCalled();
  });

  it("returns [] when Grok HTTP request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "boom",
      })
    );
    const { discoverViaGrok } = await import("@/lib/contact/discovery");
    const out = await discoverViaGrok("Acme");
    expect(out).toEqual([]);
  });

  it("returns [] when GROK_API_KEY is unset", async () => {
    delete process.env.GROK_API_KEY;
    vi.resetModules();
    const { discoverViaGrok } = await import("@/lib/contact/discovery");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const out = await discoverViaGrok("Acme");
    expect(out).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns [] when company is empty or too short", async () => {
    const { discoverViaGrok } = await import("@/lib/contact/discovery");
    expect(await discoverViaGrok("")).toEqual([]);
    expect(await discoverViaGrok(" ")).toEqual([]);
    expect(await discoverViaGrok("A")).toEqual([]);
  });

  it("uses citation URLs when no structured contact_url is returned", async () => {
    const citation = "https://acme.example/contact";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          mockGrokResponse({ contact_url: null, url: null }, [citation])
        )
    );
    const { scrapeContactPages, extractEmailsFromPages } = await loadMocks();
    scrapeContactPages.mockResolvedValue({
      results: [
        {
          url: citation,
          text: "Reach Acme at careers@acme.example",
          mailtos: ["careers@acme.example"],
          engine: "requests",
          ok: true,
        },
      ],
      engine_available: "requests",
    });
    extractEmailsFromPages.mockResolvedValue(["careers@acme.example"]);

    const { discoverViaGrok } = await import("@/lib/contact/discovery");
    const out = await discoverViaGrok("Acme");
    expect(out[0]?.email).toBe("careers@acme.example");
  });
});

describe("discoverViaGrokBatch (Grok URL → Python DOM → OpenAI extract)", () => {
  beforeEach(() => {
    process.env.GROK_API_KEY = "xai-test-key";
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) {
      delete process.env.GROK_API_KEY;
    } else {
      process.env.GROK_API_KEY = ORIGINAL_KEY;
    }
    vi.restoreAllMocks();
  });

  it("sends a single Grok call for contact URLs and routes each set to the scraper", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockGrokResponse({
        results: [
          {
            company: "Acme",
            contact_url: "https://acme.com/contact",
            url: "https://acme.com",
          },
          {
            company: "Widget",
            contact_url: "https://widget.io/contact",
            url: "https://widget.io",
          },
          { company: "DefunctCo", contact_url: null, url: null },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { scrapeContactPages, extractEmailsFromPages } = await loadMocks();
    scrapeContactPages.mockImplementation(async (urls: string[]) => ({
      results: urls.map((u) => ({
        url: u,
        text: `Page text for ${u}`,
        mailtos: [],
        engine: "playwright" as const,
        ok: true,
      })),
      engine_available: "playwright" as const,
    }));
    extractEmailsFromPages.mockImplementation(async (pages) => {
      const host = (pages[0]?.url ?? "").includes("acme")
        ? "acme.com"
        : "widget.io";
      return [`careers@${host}`];
    });

    const { discoverViaGrokBatch } = await import("@/lib/contact/discovery");
    const out = await discoverViaGrokBatch([
      { company: "Acme" },
      { company: "Widget" },
      { company: "DefunctCo" },
    ]);

    // Exactly one Grok call.
    const xaiCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("api.x.ai")
    );
    expect(xaiCalls.length).toBe(1);
    expect(out.get("Acme")?.[0].email).toBe("careers@acme.com");
    expect(out.get("Widget")?.[0].email).toBe("careers@widget.io");
    expect(out.has("DefunctCo")).toBe(false);
  });

  it("dedupes by lowercase company before calling Grok", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockGrokResponse({ results: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const { discoverViaGrokBatch } = await import("@/lib/contact/discovery");
    await discoverViaGrokBatch([
      { company: "Acme" },
      { company: "ACME" },
      { company: "acme" },
    ]);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const userMsg = body.messages[1].content;
    const lines =
      (userMsg.match(/Find the "Contact us" page URL for/g) ?? []).length;
    expect(lines).toBe(1);
  });

  it("returns empty map when Grok HTTP fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        text: async () => "",
      })
    );
    const { discoverViaGrokBatch } = await import("@/lib/contact/discovery");
    const out = await discoverViaGrokBatch([{ company: "Acme" }]);
    expect(out.size).toBe(0);
  });

  it("returns empty map when GROK_API_KEY missing", async () => {
    delete process.env.GROK_API_KEY;
    vi.resetModules();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { discoverViaGrokBatch } = await import("@/lib/contact/discovery");
    const out = await discoverViaGrokBatch([{ company: "Acme" }]);
    expect(out.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("recovers JSON wrapped in a markdown ```json fence", async () => {
    const fenced = `Sure, here you go:\n\n\`\`\`json\n${JSON.stringify({
      results: [
        {
          company: "Acme",
          contact_url: "https://acme.com/contact",
          url: "https://acme.com",
        },
      ],
    })}\n\`\`\`\n`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: fenced } }],
          citations: [],
        }),
        text: async () => "",
      })
    );
    const { scrapeContactPages, extractEmailsFromPages } = await loadMocks();
    scrapeContactPages.mockResolvedValue({
      results: [
        {
          url: "https://acme.com/contact",
          text: "contact@acme.com",
          mailtos: ["contact@acme.com"],
          engine: "playwright",
          ok: true,
        },
      ],
      engine_available: "playwright",
    });
    extractEmailsFromPages.mockResolvedValue(["contact@acme.com"]);
    const { discoverViaGrokBatch } = await import("@/lib/contact/discovery");
    const out = await discoverViaGrokBatch([{ company: "Acme" }]);
    expect(out.get("Acme")?.[0].email).toBe("contact@acme.com");
  });

  it("falls back to citation URLs when the structured payload has no contact_url", async () => {
    const citation = "https://acme.example/contact";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockGrokResponse(
          {
            results: [
              { company: "Acme", contact_url: null, url: null },
            ],
          },
          [citation]
        )
      )
    );
    const { scrapeContactPages, extractEmailsFromPages } = await loadMocks();
    scrapeContactPages.mockResolvedValue({
      results: [
        {
          url: citation,
          text: "Email careers@acme.example to reach hiring",
          mailtos: ["careers@acme.example"],
          engine: "requests",
          ok: true,
        },
      ],
      engine_available: "requests",
    });
    extractEmailsFromPages.mockResolvedValue(["careers@acme.example"]);
    const { discoverViaGrokBatch } = await import("@/lib/contact/discovery");
    const out = await discoverViaGrokBatch([{ company: "Acme" }]);
    expect(out.get("Acme")?.[0].email).toBe("careers@acme.example");
  });
});
