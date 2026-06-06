import { describe, expect, it, vi, beforeEach } from "vitest";

const upsertContact = vi.fn().mockResolvedValue({ id: 1 });
const listTopRelevantWithoutContacts = vi.fn();
const discoverViaGrokBatch = vi.fn();
const discoverContactsForPosting = vi.fn();

vi.mock("@/lib/agent/memory", () => ({
  memory: { listTopRelevantWithoutContacts, upsertContact },
}));

vi.mock("@/lib/llm/grok", () => ({
  isGrokConfigured: () => true,
}));

const findCompanyEmails = vi.fn().mockResolvedValue([]);

vi.mock("@/lib/contact/discovery", () => ({
  discoverFromBody: vi.fn().mockReturnValue([]),
  discoverViaGrokBatch,
  discoverContactsForPosting,
  isUsefulEmail: vi.fn().mockReturnValue(true),
  pickBestContact: vi.fn((c: Array<{ confidence: number }>) =>
    c.length ? c.sort((a, b) => b.confidence - a.confidence)[0] : null
  ),
}));

vi.mock("@/lib/langsearch/client", () => ({
  isLangSearchConfigured: () => true,
  findCompanyEmails,
}));

vi.mock("@/lib/agent/observability", () => ({
  logEvent: vi.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function jobRow(id: number, company: string, body = ""): any {
  return {
    posting: {
      id,
      title: `Role ${id}`,
      company,
      description: body,
      url: `https://example.com/${id}`,
    },
    filtered: { id, postingId: id, isRelevant: true, score: 80 },
  };
}

describe("discoverNextContacts (1-by-1 loop)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findCompanyEmails.mockResolvedValue([]);
    process.env.GROK_API_KEY = "xai-test";
    process.env.LANGSEARCH_API_KEY = "lk-test";
  });

  it("uses LangSearch before Grok and persists the first usable hit", async () => {
    listTopRelevantWithoutContacts.mockResolvedValue([jobRow(1, "Acme")]);
    findCompanyEmails.mockResolvedValue(["careers@acme.com"]);

    const { discoverNextContacts } = await import("@/lib/agent/action");
    const out = await discoverNextContacts(1);

    expect(out.attempted).toBe(1);
    expect(out.found).toBe(1);
    expect(out.results[0].email).toBe("careers@acme.com");
    expect(out.results[0].method).toBe("langsearch");
    expect(upsertContact).toHaveBeenCalledTimes(1);
    // Grok was never called because LangSearch already resolved it.
    expect(discoverViaGrokBatch).not.toHaveBeenCalled();
    expect(findCompanyEmails).toHaveBeenCalledWith("Acme");
  });

  it("falls through to Grok when LangSearch returns nothing", async () => {
    listTopRelevantWithoutContacts.mockResolvedValue([jobRow(1, "Acme")]);
    findCompanyEmails.mockResolvedValue([]);
    discoverViaGrokBatch.mockResolvedValue(
      new Map([
        [
          "Acme",
          [
            {
              email: "hr@acme.com",
              sourceType: "scraped_from_site",
              confidence: 0.9,
            },
          ],
        ],
      ])
    );

    const { discoverNextContacts } = await import("@/lib/agent/action");
    const out = await discoverNextContacts(1);
    expect(out.found).toBe(1);
    expect(out.results[0].method).toBe("grok");
    expect(findCompanyEmails).toHaveBeenCalledTimes(1);
    expect(discoverViaGrokBatch).toHaveBeenCalledTimes(1);
  });

  it("processes only the next 1 job by default", async () => {
    listTopRelevantWithoutContacts.mockResolvedValue([jobRow(1, "Acme")]);
    discoverViaGrokBatch.mockResolvedValue(
      new Map([
        [
          "Acme",
          [
            {
              email: "careers@acme.com",
              sourceType: "scraped_from_site",
              confidence: 0.9,
            },
          ],
        ],
      ])
    );

    const { discoverNextContacts } = await import("@/lib/agent/action");
    const out = await discoverNextContacts(1);
    expect(out.attempted).toBe(1);
    expect(out.found).toBe(1);
    expect(out.results[0].email).toBe("careers@acme.com");
    expect(out.results[0].method).toBe("grok");
    expect(upsertContact).toHaveBeenCalledTimes(1);
    expect(listTopRelevantWithoutContacts).toHaveBeenCalledWith(1);
  });

  it("marks the posting as skipped when neither body nor Grok nor fallback finds anything", async () => {
    listTopRelevantWithoutContacts.mockResolvedValue([jobRow(1, "GhostCo")]);
    discoverViaGrokBatch.mockResolvedValue(new Map());
    discoverContactsForPosting.mockResolvedValue([]);

    const { discoverNextContacts } = await import("@/lib/agent/action");
    const out = await discoverNextContacts(1);
    expect(out.attempted).toBe(1);
    expect(out.found).toBe(0);
    expect(out.results[0].email).toBeNull();
    expect(out.results[0].method).toBeNull();
    // Sentinel row inserted so the loop advances — was the infinite-loop bug.
    expect(upsertContact).toHaveBeenCalledTimes(1);
    expect(upsertContact).toHaveBeenCalledWith(
      expect.objectContaining({
        postingId: 1,
        sourceType: "skipped",
      })
    );
  });

  it("clamps n to [1, 5]", async () => {
    listTopRelevantWithoutContacts.mockResolvedValue([]);
    const { discoverNextContacts } = await import("@/lib/agent/action");

    await discoverNextContacts(0);
    expect(listTopRelevantWithoutContacts).toHaveBeenLastCalledWith(1);

    await discoverNextContacts(99);
    expect(listTopRelevantWithoutContacts).toHaveBeenLastCalledWith(5);

    await discoverNextContacts(3);
    expect(listTopRelevantWithoutContacts).toHaveBeenLastCalledWith(3);
  });

  it("returns { attempted: 0 } when there are no pending jobs", async () => {
    listTopRelevantWithoutContacts.mockResolvedValue([]);
    const { discoverNextContacts } = await import("@/lib/agent/action");
    const out = await discoverNextContacts(1);
    expect(out).toEqual({ attempted: 0, found: 0, results: [] });
  });
});
