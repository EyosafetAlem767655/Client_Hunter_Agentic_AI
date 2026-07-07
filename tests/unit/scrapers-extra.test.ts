import { describe, expect, it, vi, beforeEach } from "vitest";
import { ArbeitnowScraper } from "@/lib/scrapers/arbeitnow";
import { JobicyScraper } from "@/lib/scrapers/jobicy";
import { RemotiveScraper } from "@/lib/scrapers/remotive";
import { WwrDomScraper } from "@/lib/scrapers/wwr-dom";
import { IndeedScraper } from "@/lib/scrapers/indeed";
import { BaseScraper } from "@/lib/scrapers/base";
import { LinkedInScraper } from "@/lib/scrapers/linkedin";
import { scraperForSource, ENABLED_SOURCES } from "@/lib/scrapers";

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
      if (url.includes("medical+receptionist")) {
        return jsonResponse({ jobs: [job(1, "Medical Receptionist"), job(2, "Front Desk Receptionist")] });
      }
      if (url.includes("patient+coordinator")) {
        return jsonResponse({ jobs: [job(2, "Front Desk Receptionist"), job(3, "Patient Coordinator")] });
      }
      if (url.includes("medical+biller")) {
        return jsonResponse({ jobs: [job(4, "Medical Biller")] });
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

  it("follows Arbeitnow pagination before prioritizing matching roles", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("page=2")) {
          return jsonResponse({
            data: [
              {
                slug: "support-remote",
                company_name: "SupportCo",
                title: "Customer Support Specialist",
                description: "Remote support tickets for European customers.",
                remote: true,
                url: "https://www.arbeitnow.com/jobs/support-remote",
                tags: ["support"],
                job_types: ["full-time"],
                location: "Remote",
                created_at: 1700002000,
              },
            ],
            links: { next: null },
          });
        }
        return jsonResponse({
          data: [
            {
              slug: "engineer-berlin",
              company_name: "BuildCo",
              title: "Senior Engineer",
              description: "Build APIs.",
              remote: true,
              url: "https://www.arbeitnow.com/jobs/engineer-berlin",
              tags: ["engineering"],
              job_types: ["full-time"],
              location: "Berlin, Germany",
              created_at: 1700001000,
            },
          ],
          links: { next: "https://www.arbeitnow.com/api/job-board-api?page=2" },
        });
      })
    );

    const out = await new ArbeitnowScraper("bot@example.com").fetch(1);
    expect(out).toHaveLength(1);
    expect(out[0].externalId).toBe("support-remote");
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
        if (url.includes("healthcare")) {
          return jsonResponse({ jobs: [job("a", "Medical Receptionist")] });
        }
        if (url.includes("medical")) {
          return jsonResponse({ jobs: [job("a", "Medical Receptionist"), job("b", "Medical Biller")] });
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

  it("parses WWR category RSS feed and dedupes by URL", async () => {
    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>WeWorkRemotely - Customer Support</title>
    <item>
      <title><![CDATA[Acme Health: Medical Receptionist]]></title>
      <link>https://weworkremotely.com/remote-jobs/acme-health-medical-receptionist</link>
      <guid>https://weworkremotely.com/remote-jobs/acme-health-medical-receptionist</guid>
      <region>USA Only</region>
    </item>
    <item>
      <title><![CDATA[WidgetCo: Patient Coordinator]]></title>
      <link>https://weworkremotely.com/remote-jobs/widgetco-patient-coordinator</link>
      <guid>https://weworkremotely.com/remote-jobs/widgetco-patient-coordinator</guid>
      <region>Anywhere</region>
    </item>
  </channel>
</rss>`;

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => rss }));

    const out = await new WwrDomScraper("bot@example.com").fetch(10);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out[0].source).toBe("wwr_dom");
    expect(out[0].url).toMatch(/^https:\/\/weworkremotely\.com\/remote-jobs\//);
    expect(out[0].title).toBeTruthy();
    expect(out[0].company).toBe("Acme Health");
    expect(out[1].title).toBe("Patient Coordinator");
  });

  it("returns an empty array when all RSS requests fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("blocked"))
    );
    const out = await new WwrDomScraper("bot@example.com").fetch(5);
    expect(out).toEqual([]);
  });
});

describe("IndeedScraper", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("parses jobs from embedded mosaic JSON", async () => {
    const mosaicData = {
      metaData: {
        mosaicProviderJobCardsModel: {
          results: [
            {
              jobkey: "abc123",
              displayTitle: "Virtual Assistant",
              company: "VirtualCo",
              jobLocationCity: "Austin",
              jobLocationState: "TX",
              snippet: "Support our exec team remotely.",
              pubDate: 1700000000000,
            },
            {
              jobkey: "def456",
              displayTitle: "Customer Support Specialist",
              company: "HelpDesk Inc",
              jobLocationCity: null,
              jobLocationState: null,
              snippet: "Handle tickets via Zendesk.",
              pubDate: 1700001000000,
            },
          ],
        },
      },
    };
    const html = `<html><body><script>
      window.mosaic.providerData["mosaic-provider-jobcards"] = ${JSON.stringify(mosaicData)};
    </script></body></html>`;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (String(url).includes("robots.txt")) {
          return { ok: true, status: 200, text: async () => "" };
        }
        return { ok: true, status: 200, text: async () => html };
      })
    );

    const out = await new IndeedScraper("bot@example.com").fetch(10);
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out[0].source).toBe("indeed");
    expect(out[0].externalId).toBe("abc123");
    expect(out[0].title).toBe("Virtual Assistant");
    expect(out[0].company).toBe("VirtualCo");
    expect(out[0].url).toBe("https://www.indeed.com/viewjob?jk=abc123");
    expect(out[0].postedAt).toBeInstanceOf(Date);
    expect(out[1].location).toBe("Remote");
  });

  it("falls back to HTML card parsing when mosaic JSON is absent", async () => {
    const html = `<html><body>
      <div data-testid="slider_item">
        <h2 class="jobTitle"><a href="/rc/clk?jk=xyz789">Customer Service Rep</a></h2>
        <span class="companyName">ServiceCo</span>
        <div class="companyLocation">Remote</div>
        <div class="job-snippet">Handle inbound customer queries.</div>
      </div>
    </body></html>`;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (String(url).includes("robots.txt")) {
          return { ok: true, status: 200, text: async () => "" };
        }
        return { ok: true, status: 200, text: async () => html };
      })
    );

    const out = await new IndeedScraper("bot@example.com").fetch(10);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0].source).toBe("indeed");
    expect(out[0].title).toBe("Customer Service Rep");
  });

  it("returns empty array when page yields no postings (blocked/captcha)", async () => {
    const html = "<html><body><p>We could not find any jobs.</p></body></html>";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        if (String(url).includes("robots.txt")) {
          return { ok: true, status: 200, text: async () => "" };
        }
        return { ok: true, status: 200, text: async () => html };
      })
    );

    const out = await new IndeedScraper("bot@example.com").fetch(10);
    expect(out).toEqual([]);
  });
});

describe("LinkedInScraper", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns empty array gracefully when domain is blocked", async () => {
    // BaseScraper.fetchWithRetry calls assertAllowedUrl which blocks linkedin.com.
    // The scraper must catch the error and return [] rather than propagating.
    const scraper = new LinkedInScraper("bot@example.com");
    const result = await scraper.fetch(10);
    expect(result).toEqual([]);
  });

  it("parses LinkedIn jobs HTML into postings", async () => {
    const html = `<ul>
      <li>
        <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/111?trk=xyz"></a>
        <h3 class="base-search-card__title">Virtual Assistant</h3>
        <h4 class="base-search-card__subtitle">HealthCo</h4>
        <span class="job-search-card__location">United States</span>
      </li>
      <li>
        <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/222"></a>
        <h3 class="base-search-card__title">Medical Receptionist</h3>
        <h4 class="base-search-card__subtitle">MediCo</h4>
        <span class="job-search-card__location">Remote</span>
      </li>
    </ul>`;

    // Bypass assertAllowedUrl by mocking the protected method on the prototype
    vi.spyOn(BaseScraper.prototype as never, "fetchWithRetry").mockResolvedValue({
      text: async () => html,
    } as unknown as Response);

    const scraper = new LinkedInScraper("bot@example.com");
    const result = await scraper.fetch(2);
    expect(result).toHaveLength(2);
    expect(result[0].source).toBe("linkedin");
    expect(result[0].title).toBe("Virtual Assistant");
    expect(result[0].company).toBe("HealthCo");
    expect(result[0].url).toBe("https://www.linkedin.com/jobs/view/111");
    expect(result[1].title).toBe("Medical Receptionist");
    expect(result[1].company).toBe("MediCo");
  });
});

describe("scraperForSource", () => {
  it("returns a scraper instance for every enabled source", () => {
    for (const source of ENABLED_SOURCES) {
      const scraper = scraperForSource(source);
      expect(scraper, `scraperForSource("${source}") should not be null`).not.toBeNull();
      expect(scraper!.source).toBe(source);
    }
  });

  it("returns null for unknown sources", () => {
    // @ts-expect-error testing invalid input
    expect(scraperForSource("unknown_board")).toBeNull();
  });
});
