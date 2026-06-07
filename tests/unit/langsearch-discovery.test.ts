import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findContactUrls: vi.fn(),
  filterContactUrls: vi.fn(),
  scrapeContactPages: vi.fn(),
  extractEmailsFromPages: vi.fn(),
  logEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/langsearch/client", () => ({
  findContactUrls: mocks.findContactUrls,
}));

vi.mock("@/lib/contact/url-filter", () => ({
  filterContactUrls: mocks.filterContactUrls,
}));

vi.mock("@/lib/contact/python-scraper", () => ({
  scrapeContactPages: mocks.scrapeContactPages,
}));

vi.mock("@/lib/contact/llm-email-extractor", () => ({
  extractEmailsFromPages: mocks.extractEmailsFromPages,
}));

vi.mock("@/lib/agent/observability", () => ({
  logEvent: mocks.logEvent,
}));

const candidates = [
  {
    title: "CRAE GROUP LTD - Contact Us",
    url: "https://www.craegroup.com/contact",
    displayUrl: "craegroup.com/contact",
    snippet: "Contact CRAE GROUP LTD",
    summary: "Official contact page",
  },
];

const scrapedPage = {
  url: "https://www.craegroup.com/contact",
  text: "Contact contact@craegroup.com",
  mailtos: ["contact@craegroup.com"],
  elements: [
    {
      tag: "a",
      attributes: { href: "mailto:contact@craegroup.com" },
      text: "contact@craegroup.com",
    },
  ],
  engine: "requests" as const,
  ok: true,
};

describe("LangSearch contact discovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findContactUrls.mockResolvedValue(candidates);
    mocks.filterContactUrls.mockResolvedValue(["https://www.craegroup.com/contact"]);
    mocks.scrapeContactPages.mockResolvedValue({
      results: [scrapedPage],
      engine_available: "requests",
    });
    mocks.extractEmailsFromPages.mockResolvedValue(["contact@craegroup.com"]);
  });

  it("saves email contacts with the source contact URL", async () => {
    const { discoverViaLangSearch } = await import("@/lib/contact/discovery");

    const out = await discoverViaLangSearch("CRAE GROUP LTD", {
      url: "https://jobboard.example/jobs/1",
    });

    expect(mocks.findContactUrls).toHaveBeenCalledWith("CRAE GROUP LTD");
    expect(mocks.filterContactUrls).toHaveBeenCalledWith(
      "CRAE GROUP LTD",
      candidates
    );
    expect(mocks.scrapeContactPages).toHaveBeenCalledWith([
      "https://www.craegroup.com/contact",
    ]);
    expect(out[0]).toMatchObject({
      email: "contact@craegroup.com",
      contactUrl: "https://www.craegroup.com/contact",
      sourceType: "langsearch_scraped",
    });
  });

  it("saves URL-only contacts when scraping finds no email", async () => {
    mocks.extractEmailsFromPages.mockResolvedValue([]);
    const { discoverViaLangSearch } = await import("@/lib/contact/discovery");

    const out = await discoverViaLangSearch("CRAE GROUP LTD", {
      url: "https://jobboard.example/jobs/1",
    });

    expect(out).toEqual([
      {
        email: null,
        contactUrl: "https://www.craegroup.com/contact",
        sourceType: "url_only",
        confidence: 0.4,
      },
    ]);
  });

  it("falls back to the raw LangSearch URL when the LLM filter rejects every candidate", async () => {
    // The LLM threw out every candidate but LangSearch still returned URLs —
    // keep one as a url_only contact so the discovery row is never empty.
    mocks.filterContactUrls.mockResolvedValue([]);
    const { discoverViaLangSearch } = await import("@/lib/contact/discovery");

    const out = await discoverViaLangSearch("CRAE GROUP LTD", {
      url: "https://jobboard.example/jobs/1",
    });

    expect(out).toEqual([
      {
        email: null,
        contactUrl: "https://www.craegroup.com/contact",
        sourceType: "url_only",
        confidence: 0.3,
      },
    ]);
    // We didn't waste a scrape on a URL the LLM rejected.
    expect(mocks.scrapeContactPages).not.toHaveBeenCalled();
  });

  it("returns no contact when LangSearch returns nothing at all", async () => {
    mocks.findContactUrls.mockResolvedValue([]);
    mocks.filterContactUrls.mockResolvedValue([]);
    const { discoverContactsForPosting } = await import("@/lib/contact/discovery");

    const out = await discoverContactsForPosting({
      description: "Apply online.",
      company: "GhostCo",
      url: "https://jobboard.example/jobs/ghost",
    });

    expect(out).toEqual([]);
  });

  it("returns body emails before doing LangSearch work", async () => {
    const { discoverContactsForPosting } = await import("@/lib/contact/discovery");

    const out = await discoverContactsForPosting({
      description: "Please email hiring@realcompany.com",
      company: "Real Company",
      url: "https://jobs.example/real",
    });

    expect(out[0]).toMatchObject({
      email: "hiring@realcompany.com",
      sourceType: "listed",
    });
    expect(mocks.findContactUrls).not.toHaveBeenCalled();
  });
});
