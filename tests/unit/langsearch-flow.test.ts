import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listTopRelevantWithoutContacts: vi.fn(),
  upsertContact: vi.fn().mockResolvedValue({ id: 1 }),
  discoverContactsForPosting: vi.fn(),
  discoverFromBody: vi.fn().mockReturnValue([]),
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
function jobRow(id: number, company: string): any {
  return {
    posting: {
      id,
      title: `Role ${id}`,
      company,
      description: "Apply online",
      url: `https://jobboard.example/jobs/${id}`,
    },
  };
}

describe("discoverContactsForTopJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists email and URL-only contacts through the same discovery flow", async () => {
    mocks.listTopRelevantWithoutContacts.mockResolvedValue([
      jobRow(1, "Acme"),
      jobRow(2, "GhostCo"),
    ]);
    mocks.discoverContactsForPosting.mockImplementation(({ company }) => {
      if (company === "Acme") {
        return Promise.resolve([
          {
            email: "careers@acme.com",
            contactUrl: "https://acme.com/contact",
            sourceType: "langsearch_scraped",
            confidence: 0.92,
          },
        ]);
      }
      return Promise.resolve([
        {
          email: null,
          contactUrl: "https://ghost.example/contact",
          sourceType: "url_only",
          confidence: 0.4,
        },
      ]);
    });

    const { discoverContactsForTopJobs } = await import("@/lib/agent/action");
    const count = await discoverContactsForTopJobs(10);

    expect(count).toBe(2);
    expect(mocks.upsertContact).toHaveBeenCalledWith({
      postingId: 1,
      email: "careers@acme.com",
      contactUrl: "https://acme.com/contact",
      sourceType: "langsearch_scraped",
      confidence: "0.92",
    });
    expect(mocks.upsertContact).toHaveBeenCalledWith({
      postingId: 2,
      email: null,
      contactUrl: "https://ghost.example/contact",
      sourceType: "url_only",
      confidence: "0.40",
    });
  }, 15_000);
});
