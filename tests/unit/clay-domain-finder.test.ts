import { describe, expect, it } from "vitest";
import {
  toUniqueDomains,
  parseBrowseHtml,
  parseDomainAnswer,
} from "@/lib/clay/domain-finder";

describe("toUniqueDomains", () => {
  it("drops aggregators, dedupes to registrable domains, preserves order", () => {
    const domains = toUniqueDomains([
      { url: "https://www.linkedin.com/company/quickteam" }, // aggregator
      { url: "https://quickteam.com/about" },
      { url: "https://www.quickteam.com/careers" }, // dupe of quickteam.com
      { url: "https://go.getocra.com/x" }, // registrable getocra.com
      { url: "https://crunchbase.com/quickteam" }, // aggregator
      { url: "not a url" }, // skipped
    ]);
    expect(domains).toEqual(["quickteam.com", "getocra.com"]);
  });

  it("respects the max cap", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ url: `https://co${i}.com` }));
    expect(toUniqueDomains(many, 3)).toHaveLength(3);
  });

  it("treats country-TLD variants as distinct domains", () => {
    const domains = toUniqueDomains([
      { url: "https://quickteam.com" },
      { url: "https://quickteam.ca" },
    ]);
    expect(domains).toEqual(["quickteam.com", "quickteam.ca"]);
  });
});

describe("parseBrowseHtml", () => {
  it("extracts title, meta description, and canonical", () => {
    const html = `
      <html><head>
        <title>  QuickTeam — Remote Staffing  </title>
        <meta name="description" content="We provide remote virtual assistants." />
        <link rel="canonical" href="https://quickteam.com/" />
      </head><body>ignored</body></html>`;
    const out = parseBrowseHtml(html);
    expect(out.title).toBe("QuickTeam — Remote Staffing");
    expect(out.description).toBe("We provide remote virtual assistants.");
    expect(out.canonical).toBe("https://quickteam.com/");
  });

  it("returns empty strings when tags are absent", () => {
    const out = parseBrowseHtml("<html><body>nothing here</body></html>");
    expect(out).toEqual({ title: "", description: "", canonical: "" });
  });
});

describe("parseDomainAnswer", () => {
  it("parses a DOMAIN: line and strips scheme/www/trailing slash", () => {
    expect(parseDomainAnswer("reasoning...\nDOMAIN: https://www.quickteam.com/")).toBe(
      "quickteam.com"
    );
    expect(parseDomainAnswer("DOMAIN: quickteam.com")).toBe("quickteam.com");
  });

  it("returns null for NONE or a missing line", () => {
    expect(parseDomainAnswer("no confident match\nDOMAIN: NONE")).toBeNull();
    expect(parseDomainAnswer("just some text without the marker")).toBeNull();
  });
});
