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

vi.mock("@/lib/contact/discovery", () => ({
  discoverFromBody: vi.fn().mockReturnValue([]),
  discoverViaGrokBatch,
  discoverContactsForPosting,
  pickBestContact: vi.fn((c: Array<{ confidence: number }>) =>
    c.length ? c.sort((a, b) => b.confidence - a.confidence)[0] : null
  ),
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
    process.env.GROK_API_KEY = "xai-test";
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

  it("returns null when neither body nor Grok nor fallback finds anything", async () => {
    listTopRelevantWithoutContacts.mockResolvedValue([jobRow(1, "GhostCo")]);
    discoverViaGrokBatch.mockResolvedValue(new Map());
    discoverContactsForPosting.mockResolvedValue([]);

    const { discoverNextContacts } = await import("@/lib/agent/action");
    const out = await discoverNextContacts(1);
    expect(out.attempted).toBe(1);
    expect(out.found).toBe(0);
    expect(out.results[0].email).toBeNull();
    expect(out.results[0].method).toBeNull();
    expect(upsertContact).not.toHaveBeenCalled();
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
