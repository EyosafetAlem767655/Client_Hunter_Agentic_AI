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

function mockPage(html: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => html,
  };
}

describe("discoverViaGrok (URL → scrape)", () => {
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

  it("asks Grok for the company URL then scrapes the page for emails", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("api.x.ai")) {
        return mockGrokResponse({
          url: "https://acmestartup.io",
          contact_url: "https://acmestartup.io/contact",
        });
      }
      if (String(url) === "https://acmestartup.io/contact") {
        return mockPage(
          "<html><body>Reach us at <a href='mailto:careers@acmestartup.io'>careers@acmestartup.io</a> or hello@acmestartup.io</body></html>"
        );
      }
      return mockPage("");
    });
    vi.stubGlobal("fetch", fetchMock);

    const { discoverViaGrok } = await import("@/lib/contact/discovery");
    const out = await discoverViaGrok("AcmeStartup", {
      url: "https://acmestartup.io/jobs/1",
    });

    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0].email).toBe("careers@acmestartup.io");
    expect(out[0].sourceType).toBe("scraped_from_site");
    // Alternates ranked lower
    const alt = out.find((c) => c.email === "hello@acmestartup.io");
    expect(alt).toBeDefined();
    expect(alt!.confidence).toBeLessThan(out[0].confidence);

    // Verify Grok endpoint received a URL-discovery prompt (not an email prompt).
    const xaiCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("api.x.ai")
    );
    expect(xaiCall).toBeDefined();
    const body = JSON.parse(xaiCall![1].body);
    const userMsg = body.messages[1].content;
    expect(userMsg).toContain("website URL");
    expect(userMsg).not.toContain("the email for");
  });

  it("filters out automation noise from the scraped page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (String(url).includes("api.x.ai")) {
          return mockGrokResponse({
            url: "https://acme.com",
            contact_url: "https://acme.com/contact",
          });
        }
        return mockPage(
          "<html>noreply@acme.com info@acme.com real@goodcompany.io</html>"
        );
      })
    );
    const { discoverViaGrok } = await import("@/lib/contact/discovery");
    const out = await discoverViaGrok("Acme");
    // noreply blocked; info@/personal allowed.
    expect(out.map((c) => c.email)).toContain("info@acme.com");
    expect(out.map((c) => c.email)).toContain("real@goodcompany.io");
    expect(out.map((c) => c.email)).not.toContain("noreply@acme.com");
  });

  it("returns [] when Grok returns no URL and no citations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockGrokResponse({ url: null, contact_url: null })
      )
    );
    const { discoverViaGrok } = await import("@/lib/contact/discovery");
    const out = await discoverViaGrok("DefunctCo");
    expect(out).toEqual([]);
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

  it("returns [] when GROK_API_KEY is unset (graceful fallback)", async () => {
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

  it("falls through to citation URLs when no structured URL is returned", async () => {
    const citation = "https://acme.example/contact";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (String(url).includes("api.x.ai")) {
          return mockGrokResponse(
            { url: null, contact_url: null },
            [citation]
          );
        }
        if (String(url) === citation) {
          return mockPage(
            "<html>Reach Acme at <a href='mailto:careers@acme.example'>careers@acme.example</a></html>"
          );
        }
        return mockPage("");
      })
    );
    const { discoverViaGrok } = await import("@/lib/contact/discovery");
    const out = await discoverViaGrok("Acme");
    expect(out[0]?.email).toBe("careers@acme.example");
  });
});

describe("discoverViaGrokBatch (URL → scrape)", () => {
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

  it("sends a single Grok call for URLs and scrapes each page for emails", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("api.x.ai")) {
        return mockGrokResponse({
          results: [
            {
              company: "Acme",
              url: "https://acme.com",
              contact_url: "https://acme.com/contact",
            },
            {
              company: "Widget",
              url: "https://widget.io",
              contact_url: "https://widget.io/contact",
            },
            { company: "DefunctCo", url: null, contact_url: null },
          ],
        });
      }
      if (String(url) === "https://acme.com/contact") {
        return mockPage("Email: careers@acme.com");
      }
      if (String(url) === "https://widget.io/contact") {
        return mockPage("Contact: hiring@widget.io");
      }
      return mockPage("");
    });
    vi.stubGlobal("fetch", fetchMock);

    const { discoverViaGrokBatch } = await import("@/lib/contact/discovery");
    const out = await discoverViaGrokBatch([
      { company: "Acme" },
      { company: "Widget" },
      { company: "DefunctCo" },
    ]);

    // Grok endpoint hit exactly once.
    const xaiCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("api.x.ai")
    );
    expect(xaiCalls.length).toBe(1);
    expect(out.get("Acme")?.[0].email).toBe("careers@acme.com");
    expect(out.get("Widget")?.[0].email).toBe("hiring@widget.io");
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
    const lines = (
      userMsg.match(/search the company URL for/g) ?? []
    ).length;
    expect(lines).toBe(1);
  });

  it("returns empty map when Grok HTTP fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 502, text: async () => "" })
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
          url: "https://acme.com",
          contact_url: "https://acme.com/contact",
        },
      ],
    })}\n\`\`\`\n`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (String(url).includes("api.x.ai")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [{ message: { content: fenced } }],
              citations: [],
            }),
            text: async () => "",
          };
        }
        return mockPage("Email contact@acme.com");
      })
    );
    const { discoverViaGrokBatch } = await import("@/lib/contact/discovery");
    const out = await discoverViaGrokBatch([{ company: "Acme" }]);
    expect(out.get("Acme")?.[0].email).toBe("contact@acme.com");
  });

  it("falls back to citation URLs when the structured payload has no URL", async () => {
    const citation = "https://acme.example/contact";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (String(url).includes("api.x.ai")) {
          return mockGrokResponse(
            {
              results: [
                { company: "Acme", url: null, contact_url: null },
              ],
            },
            [citation]
          );
        }
        if (String(url) === citation) {
          return mockPage(
            "<html>Reach Acme at <a href='mailto:careers@acme.example'>careers@acme.example</a></html>"
          );
        }
        return mockPage("");
      })
    );
    const { discoverViaGrokBatch } = await import("@/lib/contact/discovery");
    const out = await discoverViaGrokBatch([{ company: "Acme" }]);
    expect(out.get("Acme")?.[0].email).toBe("careers@acme.example");
  });
});
