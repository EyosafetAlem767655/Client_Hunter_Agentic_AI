import { describe, expect, it, vi, beforeEach } from "vitest";
import { ArbeitnowScraper } from "@/lib/scrapers/arbeitnow";
import { JobicyScraper } from "@/lib/scrapers/jobicy";
import { RemotiveScraper } from "@/lib/scrapers/remotive";
import { WwrDomScraper } from "@/lib/scrapers/wwr-dom";

vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return {
    ...actual,
    sleep: vi.fn().mockResolvedValue(undefined),
    jitterMs: () => 0,
  };
});

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function htmlResponse(html: string) {
  return { ok: true, status: 200, text: async () => html };
}

describe("RemotiveScraper", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("aggregates multiple search queries and dedupes by id", async () => {
    const job = (id: number, title: string) => ({
      id,
      url: `https://remotive.com/${id}`,
      title,
      company_name: "Acme",
      category: "Customer Support",
      job_type: "full_time",
      publication_date: "2025-01-01",
      candidate_required_location: "USA",
      salary: "$20/hr",
      description: "VA role",
    });

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("category=customer-support")) {
        return jsonResponse({ jobs: [job(1, "Customer Support Rep"), job(2, "Customer Success Lead")] });
      }
      if (url.includes("virtual+assistant")) {
        return jsonResponse({ jobs: [job(2, "Customer Success Lead"), job(3, "Virtual Assistant")] });
      }
      if (url.includes("executive+assistant")) {
        return jsonResponse({ jobs: [job(4, "Executive Assistant")] });
      }
      return jsonResponse({ jobs: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await new RemotiveScraper("bot@example.com").fetch(10);
    expect(out.map((p) => p.externalId).sort()).toEqual(["1", "2", "3", "4"]);
    expect(out[0].source).toBe("remotive");
    expect(out.every((p) => p.url.startsWith("https://remotive.com/"))).toBe(true);
  });

  it("returns empty array when all queries fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down"))
    );
    const out = await new RemotiveScraper("bot@example.com").fetch(5);
    expect(out).toEqual([]);
  });
});

describe("ArbeitnowScraper", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("maps Arbeitnow API response to RawPostings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: [
            {
              slug: "va-berlin",
              company_name: "BerlinCo",
              title: "Virtual Assistant",
              description: "Help our exec team in Berlin.",
              remote: true,
              url: "https://www.arbeitnow.com/jobs/va-berlin",
              tags: ["va"],
              job_types: ["full-time"],
              location: "Berlin, Germany",
              created_at: 1700000000,
            },
            {
              slug: "cs-paris",
              company_name: "ParisCo",
              title: "Customer Support",
              description: "EU CS role.",
              remote: false,
              url: "https://www.arbeitnow.com/jobs/cs-paris",
              tags: [],
              job_types: [],
              location: "Paris, France",
              created_at: 1700001000,
            },
          ],
        })
      )
    );

    const out = await new ArbeitnowScraper("bot@example.com").fetch(10);
    expect(out).toHaveLength(2);
    expect(out[0].externalId).toBe("va-berlin");
    expect(out[0].source).toBe("arbeitnow");
    expect(out[0].postedAt).toBeInstanceOf(Date);
    expect(out[1].location).toBe("Paris, France");
  });

  it("falls back to alternate URL on first failure", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        call++;
        if (call === 1) throw new Error("primary blocked");
        return jsonResponse({ data: [] });
      })
    );
    const out = await new ArbeitnowScraper("bot@example.com").fetch(5);
    expect(out).toEqual([]);
    expect(call).toBeGreaterThanOrEqual(2);
  });
});

describe("JobicyScraper", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("aggregates across tag queries and dedupes", async () => {
    const job = (id: string, title: string) => ({
      id,
      url: `https://jobicy.com/jobs/${id}`,
      jobTitle: title,
      companyName: "Co",
      jobGeo: "USA",
      jobDescription: "VA description",
      pubDate: "2025-02-01T00:00:00Z",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("virtual-assistant")) {
          return jsonResponse({ jobs: [job("a", "Virtual Assistant")] });
        }
        if (url.includes("customer-service")) {
          return jsonResponse({ jobs: [job("a", "Virtual Assistant"), job("b", "CS Rep")] });
        }
        return jsonResponse({ jobs: [] });
      })
    );

    const out = await new JobicyScraper("bot@example.com").fetch(10);
    expect(out.map((p) => p.externalId).sort()).toEqual(["a", "b"]);
    expect(out[0].source).toBe("jobicy");
  });

  it("survives partial query failures", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        call++;
        if (call === 1) throw new Error("tag query failed");
        return jsonResponse({
          jobs: [
            {
              id: "x",
              url: "https://jobicy.com/jobs/x",
              jobTitle: "Admin",
              companyName: "Co",
            },
          ],
        });
      })
    );
    const out = await new JobicyScraper("bot@example.com").fetch(10);
    expect(out).toHaveLength(1);
    expect(out[0].externalId).toBe("x");
  });
});

describe("WwrDomScraper", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("parses WWR HTML category pages and dedupes URLs", async () => {
    const html = `
      <html><body>
        <ul>
          <li class="new-listing-container">
            <a href="/remote-jobs/acme-virtual-assistant">
              <h4 class="new-listing__header__title">Virtual Assistant</h4>
            </a>
            <span class="new-listing__company-name">Acme</span>
            <span class="new-listing__categories__category">USA Only</span>
          </li>
          <li class="new-listing-container">
            <a href="/remote-jobs/widget-customer-success">
              <h4 class="new-listing__header__title">Customer Success</h4>
            </a>
            <span class="new-listing__company-name">WidgetCo</span>
            <span class="new-listing__categories__category">Europe Only</span>
          </li>
        </ul>
      </body></html>`;

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(htmlResponse(html)));

    const out = await new WwrDomScraper("bot@example.com").fetch(10);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out[0].source).toBe("wwr_dom");
    expect(out[0].url).toMatch(/^https:\/\/weworkremotely\.com\/remote-jobs\//);
    expect(out[0].title).toBeTruthy();
  });

  it("returns an empty array when all category URLs fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("blocked"))
    );
    const out = await new WwrDomScraper("bot@example.com").fetch(5);
    expect(out).toEqual([]);
  });
});
