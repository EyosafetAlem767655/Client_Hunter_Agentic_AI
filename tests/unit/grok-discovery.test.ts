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

describe("discoverViaGrok", () => {
  beforeEach(() => {
    process.env.GROK_API_KEY = "xai-test-key";
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) {
      delete process.env.GROK_API_KEY;
    } else {
      process.env.GROK_API_KEY = ORIGINAL_KEY;
    }
    vi.restoreAllMocks();
  });

  it("returns the email Grok found with a high confidence score", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockGrokResponse(
        {
          email: "careers@acmestartup.io",
          alternates: ["hello@acmestartup.io"],
          source_url: "https://acmestartup.io/careers",
          reason: "Listed on careers page footer.",
        },
        ["https://acmestartup.io/careers"]
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { discoverViaGrok } = await import("@/lib/contact/discovery");
    const out = await discoverViaGrok("AcmeStartup", {
      url: "https://acmestartup.io/jobs/1",
    });

    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0].email).toBe("careers@acmestartup.io");
    expect(out[0].confidence).toBeGreaterThanOrEqual(0.9);
    expect(out[0].sourceType).toBe("scraped_from_site");
    // Alternates ranked lower
    const alt = out.find((c) => c.email === "hello@acmestartup.io");
    expect(alt).toBeDefined();
    expect(alt!.confidence).toBeLessThan(out[0].confidence);

    // Verify the Grok endpoint was actually used
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer xai-test-key");
    const body = JSON.parse(init.body);
    expect(body.search_parameters.mode).toBe("on");
    expect(body.search_parameters.return_citations).toBe(true);
  });

  it("drops only obvious automation locals (noreply/postmaster); accepts everything else", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockGrokResponse({
          email: "noreply@acme.com",
          alternates: ["info@acme.com", "real@goodcompany.io"],
          source_url: null,
          reason: null,
        })
      )
    );
    const { discoverViaGrok } = await import("@/lib/contact/discovery");
    const out = await discoverViaGrok("Acme");
    // Loose policy: noreply blocked, generic info@/personal@ allowed.
    expect(out.map((c) => c.email)).toEqual([
      "info@acme.com",
      "real@goodcompany.io",
    ]);
  });

  it("returns [] when Grok responds with email=null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockGrokResponse({
          email: null,
          alternates: [],
          source_url: null,
          reason: "Company appears defunct.",
        })
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
    // Reload modules so env picks up the absence.
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
});

describe("discoverViaGrokBatch", () => {
  beforeEach(() => {
    process.env.GROK_API_KEY = "xai-test-key";
    // The previous describe block may have deleted the key and reset
    // modules. Ensure env reloads with the key present so isGrokConfigured()
    // sees it.
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

  it("sends a single request for all companies and maps results back by name", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockGrokResponse({
        results: [
          {
            company: "Acme",
            email: "careers@acme.com",
            alternates: ["hr@acme.com"],
            source_url: "https://acme.com/careers",
            reason: "Found on careers page.",
          },
          {
            company: "Widget",
            email: "hiring@widget.io",
            alternates: [],
            source_url: "https://widget.io/about",
            reason: null,
          },
          {
            company: "DefunctCo",
            email: null,
            alternates: [],
            source_url: null,
            reason: "Site no longer reachable.",
          },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { discoverViaGrokBatch } = await import("@/lib/contact/discovery");
    const out = await discoverViaGrokBatch([
      { company: "Acme" },
      { company: "Widget" },
      { company: "DefunctCo" },
    ]);

    // Grok endpoint hit once (other fetches may come from neon-http logging).
    const xaiCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("api.x.ai")
    );
    expect(xaiCalls.length).toBe(1);
    expect(out.get("Acme")?.[0].email).toBe("careers@acme.com");
    expect(out.get("Widget")?.[0].email).toBe("hiring@widget.io");
    expect(out.has("DefunctCo")).toBe(false);
    // Alternates ranked lower than primary
    const acmeAlt = out.get("Acme")?.find((c) => c.email === "hr@acme.com");
    expect(acmeAlt?.confidence).toBeLessThan(out.get("Acme")![0].confidence);
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
    // Only one "search the email…" line in the user prompt after dedupe.
    const userMsg = body.messages[1].content;
    const lines = (userMsg.match(/search the email for the company called/g) ?? []).length;
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
        { company: "Acme", email: "contact@acme.com", alternates: [] },
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
    const { discoverViaGrokBatch } = await import("@/lib/contact/discovery");
    const out = await discoverViaGrokBatch([{ company: "Acme" }]);
    expect(out.get("Acme")?.[0].email).toBe("contact@acme.com");
  });

  it("fetches Grok citations and grabs the email from the actual page when the snippet hid it", async () => {
    let xaiCalls = 0;
    const citation = "https://acme.example/contact";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (String(url).includes("api.x.ai")) {
          xaiCalls++;
          // Grok returns email: null but cites the contact page.
          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      results: [
                        {
                          company: "Acme",
                          email: null,
                          alternates: [],
                        },
                      ],
                    }),
                  },
                },
              ],
              citations: [citation],
            }),
            text: async () => "",
          };
        }
        if (String(url) === citation) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              "<html><body>Reach Acme at <a href='mailto:careers@acme.example'>careers@acme.example</a></body></html>",
          };
        }
        return { ok: false, status: 404, text: async () => "" };
      })
    );
    const { discoverViaGrokBatch } = await import("@/lib/contact/discovery");
    const out = await discoverViaGrokBatch([{ company: "Acme" }]);
    expect(xaiCalls).toBe(1);
    expect(out.get("Acme")?.[0].email).toBe("careers@acme.example");
  });

  it("harvests emails from prose when Grok ignores the JSON instruction", async () => {
    const prose =
      "Couldn't structure this perfectly but here's what I found: " +
      "For Acme, the careers team uses hello@acme.com and for Widget try info@widget.io — both look genuine.";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: prose } }],
          citations: [],
        }),
        text: async () => "",
      })
    );
    const { discoverViaGrokBatch } = await import("@/lib/contact/discovery");
    const out = await discoverViaGrokBatch([
      { company: "Acme" },
      { company: "Widget" },
    ]);
    // Salvage pass assigned by proximity to company name in the prose.
    expect(out.get("Acme")?.[0].email).toBe("hello@acme.com");
    expect(out.get("Widget")?.[0].email).toBe("info@widget.io");
  });
});
