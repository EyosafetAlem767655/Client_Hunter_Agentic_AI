import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_KEY = process.env.LANGSEARCH_API_KEY;

afterEach(() => {
  if (ORIGINAL_KEY === undefined) {
    delete process.env.LANGSEARCH_API_KEY;
  } else {
    process.env.LANGSEARCH_API_KEY = ORIGINAL_KEY;
  }
  vi.restoreAllMocks();
});

describe("LangSearch contact URL client", () => {
  beforeEach(() => {
    process.env.LANGSEARCH_API_KEY = "sk-langsearch-test";
    vi.resetModules();
  });

  it("parses nested data.webPages.value results", async () => {
    const { parseLangSearchWebResults } = await import("@/lib/langsearch/client");
    const out = parseLangSearchWebResults({
      data: {
        webPages: {
          value: [
            {
              name: "CRAE GROUP LTD Contact",
              url: "https://www.craegroup.com/contact",
              displayUrl: "https://www.craegroup.com/contact",
              snippet: "Contact CRAE GROUP LTD",
              summary: "Contact page for CRAE GROUP LTD.",
            },
            {
              name: "Wrong Company",
              url: "https://www.cra-group.example/contact",
            },
          ],
        },
      },
    });

    expect(out).toEqual([
      {
        title: "CRAE GROUP LTD Contact",
        url: "https://www.craegroup.com/contact",
        displayUrl: "https://www.craegroup.com/contact",
        snippet: "Contact CRAE GROUP LTD",
        summary: "Contact page for CRAE GROUP LTD.",
      },
      {
        title: "Wrong Company",
        url: "https://www.cra-group.example/contact",
        displayUrl: "https://www.cra-group.example/contact",
        snippet: "",
        summary: "",
      },
    ]);
  });

  it("calls the LangSearch API directly and returns normalized URL results", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          webPages: {
            value: [
              {
                name: "Contact",
                url: "https://www.craegroup.com/contact",
                displayUrl: "craegroup.com/contact",
                snippet: "Contact us",
                summary: "Email and enquiry details.",
              },
            ],
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { findContactUrls } = await import("@/lib/langsearch/client");
    const out = await findContactUrls("CRAE GROUP LTD");

    expect(out[0]?.url).toBe("https://www.craegroup.com/contact");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Calls LangSearch directly — no Python middleman, no Vercel self-call.
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.langsearch.com/v1/web-search"
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    // Raw API key, no "Bearer " — matches LangSearch's reference snippet.
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "sk-langsearch-test"
    );
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json"
    );
    // Body includes the company name interpolated into the query string.
    expect(JSON.parse(init.body as string)).toEqual({
      query: "contact us URL for CRAE GROUP LTD",
      freshness: "noLimit",
      summary: true,
      count: 5,
    });
  });

  it("returns [] on non-2xx and network errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const { findContactUrls } = await import("@/lib/langsearch/client");
    expect(await findContactUrls("Acme")).toEqual([]);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    expect(await findContactUrls("Acme")).toEqual([]);
  });

  it("returns [] when LANGSEARCH_API_KEY is missing", async () => {
    delete process.env.LANGSEARCH_API_KEY;
    vi.resetModules();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { findContactUrls } = await import("@/lib/langsearch/client");
    expect(await findContactUrls("Acme")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns [] for empty or too-short company names", async () => {
    const { findContactUrls } = await import("@/lib/langsearch/client");
    expect(await findContactUrls("")).toEqual([]);
    expect(await findContactUrls("A")).toEqual([]);
  });
});
