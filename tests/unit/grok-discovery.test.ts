import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_KEY = process.env.GROK_API_KEY;

function mockGrokResponseText(
  text: string,
  opts: { citations?: string[]; annotations?: string[] } = {}
) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text,
              annotations: (opts.annotations ?? []).map((url, i) => ({
                type: "url_citation",
                url,
                title: String(i + 1),
              })),
            },
          ],
        },
      ],
      citations: opts.citations ?? [],
    }),
    text: async () => "",
  };
}

function responseRequest(fetchMock: ReturnType<typeof vi.fn>, index = 0) {
  const [url, init] = fetchMock.mock.calls[index];
  return {
    url: String(url),
    body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
  };
}

// Grok URL discovery -> Python DOM scrape -> OpenAI email extraction.
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

describe("discoverViaGrok (Grok URL -> Python DOM -> OpenAI extract)", () => {
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

  it("uses xAI Responses web_search with the simple Grok prompt", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        mockGrokResponseText(
          "The contact page is https://acmestartup.io/contact."
        )
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

    const request = responseRequest(fetchMock);
    expect(request.url).toBe("https://api.x.ai/v1/responses");
    expect(request.body.input).toEqual([
      { role: "system", content: "You are Grok." },
      {
        role: "user",
        content: "Search the contact us URL for this company: AcmeStartup",
      },
    ]);
    expect(request.body.tools).toEqual([{ type: "web_search" }]);
    expect(request.body).not.toHaveProperty("response_format");
    expect(request.body).not.toHaveProperty("search_parameters");
    expect(request.body).not.toHaveProperty("messages");

    const sentUrls = scrapeContactPages.mock.calls[0][0];
    expect(sentUrls[0]).toBe("https://acmestartup.io/contact");
  });

  it("returns [] when Grok produces no URL and no citations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockGrokResponseText("No contact URL found."))
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

  it("uses top-level citation URLs when output text has no URL", async () => {
    const citation = "https://acme.example/contact";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          mockGrokResponseText("The contact page is in the citation.", {
            citations: [citation],
          })
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

  it("uses annotation citation URLs when output text has no URL", async () => {
    const citation = "https://annotation.example/contact-us";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          mockGrokResponseText("The contact page is annotated.", {
            annotations: [citation],
          })
        )
    );
    const { scrapeContactPages, extractEmailsFromPages } = await loadMocks();
    scrapeContactPages.mockResolvedValue({
      results: [
        {
          url: citation,
          text: "Email contact@annotation.example",
          mailtos: ["contact@annotation.example"],
          engine: "requests",
          ok: true,
        },
      ],
      engine_available: "requests",
    });
    extractEmailsFromPages.mockResolvedValue(["contact@annotation.example"]);

    const { discoverViaGrok } = await import("@/lib/contact/discovery");
    const out = await discoverViaGrok("AnnotationCo");
    expect(out[0]?.email).toBe("contact@annotation.example");
  });

  it("extracts markdown/prose URLs and prefers contact-like paths", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockGrokResponseText(
        "Website: https://acme.com. Contact: [Contact us](https://acme.com/contact-us)."
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const { scrapeContactPages, extractEmailsFromPages } = await loadMocks();
    scrapeContactPages.mockResolvedValue({
      results: [
        {
          url: "https://acme.com/contact-us",
          text: "Email hr@acme.com",
          mailtos: ["hr@acme.com"],
          engine: "playwright",
          ok: true,
        },
      ],
      engine_available: "playwright",
    });
    extractEmailsFromPages.mockResolvedValue(["hr@acme.com"]);

    const { discoverViaGrok } = await import("@/lib/contact/discovery");
    const out = await discoverViaGrok("Acme");
    expect(out[0]?.email).toBe("hr@acme.com");
    expect(scrapeContactPages.mock.calls[0][0][0]).toBe(
      "https://acme.com/contact-us"
    );
  });
});

describe("discoverViaGrokBatch compatibility wrapper", () => {
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

  it("calls Grok once per deduped company and routes each URL to the scraper", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockGrokResponseText("https://acme.com/contact"))
      .mockResolvedValueOnce(mockGrokResponseText("https://widget.io/contact"))
      .mockResolvedValueOnce(mockGrokResponseText("No contact URL found."));
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

    const xaiCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("api.x.ai")
    );
    expect(xaiCalls.length).toBe(3);
    expect(responseRequest(fetchMock, 0).body.input).toContainEqual({
      role: "user",
      content: "Search the contact us URL for this company: Acme",
    });
    expect(responseRequest(fetchMock, 1).body.input).toContainEqual({
      role: "user",
      content: "Search the contact us URL for this company: Widget",
    });
    expect(out.get("Acme")?.[0].email).toBe("careers@acme.com");
    expect(out.get("Widget")?.[0].email).toBe("careers@widget.io");
    expect(out.has("DefunctCo")).toBe(false);
  });

  it("dedupes by lowercase company before calling Grok", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockGrokResponseText("No contact URL found."));
    vi.stubGlobal("fetch", fetchMock);
    const { discoverViaGrokBatch } = await import("@/lib/contact/discovery");
    await discoverViaGrokBatch([
      { company: "Acme" },
      { company: "ACME" },
      { company: "acme" },
    ]);

    const xaiCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("api.x.ai")
    );
    expect(xaiCalls.length).toBe(1);
    expect(responseRequest(fetchMock).body.input).toContainEqual({
      role: "user",
      content: "Search the contact us URL for this company: Acme",
    });
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

  it("falls back to citation URLs inside the compatibility wrapper", async () => {
    const citation = "https://acme.example/contact";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          mockGrokResponseText("See cited contact page.", {
            citations: [citation],
          })
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
