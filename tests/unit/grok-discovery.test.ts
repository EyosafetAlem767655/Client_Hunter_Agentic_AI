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

  it("drops blocked / noisy emails Grok returns", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        mockGrokResponse({
          email: "noreply@acme.com",
          alternates: ["foo@sentry.io", "real@goodcompany.io"],
          source_url: null,
          reason: null,
        })
      )
    );
    const { discoverViaGrok } = await import("@/lib/contact/discovery");
    const out = await discoverViaGrok("Acme");
    expect(out.map((c) => c.email)).toEqual(["real@goodcompany.io"]);
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
