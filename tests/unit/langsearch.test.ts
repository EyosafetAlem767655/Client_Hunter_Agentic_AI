import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL = process.env.LANGSEARCH_API_KEY;

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.LANGSEARCH_API_KEY;
  } else {
    process.env.LANGSEARCH_API_KEY = ORIGINAL;
  }
  vi.restoreAllMocks();
});

describe("findCompanyEmails (LangSearch client)", () => {
  beforeEach(() => {
    process.env.LANGSEARCH_API_KEY = "lk-test";
    vi.resetModules();
  });

  it("returns the emails array from a happy-path response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        emails: ["careers@acme.com", "Hello@Acme.com"],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { findCompanyEmails } = await import("@/lib/langsearch/client");
    const out = await findCompanyEmails("Acme", "acme.com");

    expect(out).toContain("careers@acme.com");
    expect(out).toContain("hello@acme.com"); // lowercased
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("company=Acme");
    expect(url).toContain("domain=acme.com");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer lk-test"
    );
  });

  it("also accepts a results: [{email}] payload shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          results: [{ email: "hr@widget.io" }, { email: "support@widget.io" }],
        }),
      })
    );
    const { findCompanyEmails } = await import("@/lib/langsearch/client");
    const out = await findCompanyEmails("Widget");
    expect(out).toEqual(
      expect.arrayContaining(["hr@widget.io", "support@widget.io"])
    );
  });

  it("returns [] on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 })
    );
    const { findCompanyEmails } = await import("@/lib/langsearch/client");
    expect(await findCompanyEmails("X")).toEqual([]);
  });

  it("returns [] on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("boom"))
    );
    const { findCompanyEmails } = await import("@/lib/langsearch/client");
    expect(await findCompanyEmails("X")).toEqual([]);
  });

  it("returns [] when LANGSEARCH_API_KEY is missing", async () => {
    delete process.env.LANGSEARCH_API_KEY;
    vi.resetModules();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { findCompanyEmails } = await import("@/lib/langsearch/client");
    expect(await findCompanyEmails("X")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns [] for empty/too-short company name", async () => {
    const { findCompanyEmails } = await import("@/lib/langsearch/client");
    expect(await findCompanyEmails("")).toEqual([]);
    expect(await findCompanyEmails("A")).toEqual([]);
  });
});
