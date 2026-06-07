import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upsertContact: vi.fn().mockResolvedValue({ id: 1 }),
  listTopRelevantWithoutContacts: vi.fn(),
  discoverFromBody: vi.fn(),
  discoverContactsForPosting: vi.fn(),
  logEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/agent/memory", () => ({
  memory: {
    listTopRelevantWithoutContacts: mocks.listTopRelevantWithoutContacts,
    upsertContact: mocks.upsertContact,
  },
}));

vi.mock("@/lib/contact/discovery", () => ({
  discoverFromBody: mocks.discoverFromBody,
  discoverContactsForPosting: mocks.discoverContactsForPosting,
  pickBestContact: vi.fn((contacts: Array<{ confidence: number }>) =>
    contacts.length
      ? [...contacts].sort((a, b) => b.confidence - a.confidence)[0]
      : null
  ),
}));

vi.mock("@/lib/agent/observability", () => ({
  logEvent: mocks.logEvent,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function jobRow(id: number, company: string, body = ""): any {
  return {
    posting: {
      id,
      title: `Role ${id}`,
      company,
      description: body,
      url: `https://jobboard.example/${id}`,
    },
    filtered: { id, postingId: id, isRelevant: true, score: 80 },
  };
}

describe("discoverNextContacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.discoverFromBody.mockReturnValue([]);
    mocks.discoverContactsForPosting.mockResolvedValue([]);
  });

  it("persists a LangSearch-scraped email with its source URL", async () => {
    mocks.listTopRelevantWithoutContacts.mockResolvedValue([jobRow(1, "Acme")]);
    mocks.discoverContactsForPosting.mockResolvedValue([
      {
        email: "careers@acme.com",
        contactUrl: "https://acme.com/contact",
        sourceType: "langsearch_scraped",
        confidence: 0.92,
      },
    ]);

    const { discoverNextContacts } = await import("@/lib/agent/action");
    const out = await discoverNextContacts(1);

    expect(out.found).toBe(1);
    expect(out.results[0]).toMatchObject({
      email: "careers@acme.com",
      contactUrl: "https://acme.com/contact",
      method: "langsearch",
    });
    expect(mocks.upsertContact).toHaveBeenCalledWith({
      postingId: 1,
      email: "careers@acme.com",
      contactUrl: "https://acme.com/contact",
      sourceType: "langsearch_scraped",
      confidence: "0.92",
    });
  });

  it("persists URL-only rows when no email is found", async () => {
    mocks.listTopRelevantWithoutContacts.mockResolvedValue([jobRow(2, "GhostCo")]);
    mocks.discoverContactsForPosting.mockResolvedValue([
      {
        email: null,
        contactUrl: "https://ghost.example/contact",
        sourceType: "url_only",
        confidence: 0.4,
      },
    ]);

    const { discoverNextContacts } = await import("@/lib/agent/action");
    const out = await discoverNextContacts(1);

    expect(out.found).toBe(1);
    expect(out.results[0]).toMatchObject({
      email: null,
      contactUrl: "https://ghost.example/contact",
      method: "url_only",
    });
    expect(mocks.upsertContact).toHaveBeenCalledWith({
      postingId: 2,
      email: null,
      contactUrl: "https://ghost.example/contact",
      sourceType: "url_only",
      confidence: "0.40",
    });
  });

  it("does not save the job posting URL if discovery fails before finding a contact URL", async () => {
    mocks.listTopRelevantWithoutContacts.mockResolvedValue([jobRow(3, "ErrCo")]);
    mocks.discoverContactsForPosting.mockRejectedValue(new Error("search down"));

    const { discoverNextContacts } = await import("@/lib/agent/action");
    const out = await discoverNextContacts(1);

    expect(out.found).toBe(0);
    expect(out.results[0]).toMatchObject({
      email: null,
      contactUrl: null,
      method: null,
    });
    expect(mocks.upsertContact).toHaveBeenCalledWith({
      postingId: 3,
      email: null,
      contactUrl: null,
      sourceType: "no_contact_url",
      confidence: "0.00",
    });
  });

  it("does not save the job posting URL when discovery returns no contact URL", async () => {
    mocks.listTopRelevantWithoutContacts.mockResolvedValue([jobRow(5, "NoUrlCo")]);
    mocks.discoverContactsForPosting.mockResolvedValue([]);

    const { discoverNextContacts } = await import("@/lib/agent/action");
    const out = await discoverNextContacts(1);

    expect(out.found).toBe(0);
    expect(out.results[0]).toMatchObject({
      email: null,
      contactUrl: null,
      method: null,
    });
    expect(mocks.upsertContact).toHaveBeenCalledWith({
      postingId: 5,
      email: null,
      contactUrl: null,
      sourceType: "no_contact_url",
      confidence: "0.00",
    });
  });

  it("uses body emails before LangSearch discovery", async () => {
    mocks.listTopRelevantWithoutContacts.mockResolvedValue([
      jobRow(4, "BodyCo", "Email hiring@bodyco.com"),
    ]);
    mocks.discoverFromBody.mockReturnValue([
      {
        email: "hiring@bodyco.com",
        contactUrl: null,
        sourceType: "listed",
        confidence: 0.9,
      },
    ]);

    const { discoverNextContacts } = await import("@/lib/agent/action");
    const out = await discoverNextContacts(1);

    expect(out.results[0].method).toBe("body");
    expect(out.results[0].email).toBe("hiring@bodyco.com");
    expect(mocks.discoverContactsForPosting).not.toHaveBeenCalled();
  });

  it("clamps n to [1, 5] and returns empty progress when no jobs remain", async () => {
    mocks.listTopRelevantWithoutContacts.mockResolvedValue([]);
    const { discoverNextContacts } = await import("@/lib/agent/action");

    await discoverNextContacts(0);
    expect(mocks.listTopRelevantWithoutContacts).toHaveBeenLastCalledWith(1);

    await discoverNextContacts(99);
    expect(mocks.listTopRelevantWithoutContacts).toHaveBeenLastCalledWith(5);

    expect(await discoverNextContacts(3)).toEqual({
      attempted: 0,
      found: 0,
      results: [],
    });
  });
});
