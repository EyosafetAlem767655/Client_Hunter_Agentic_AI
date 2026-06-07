import { describe, expect, it } from "vitest";
import { fallbackContactUrls } from "@/lib/contact/url-filter";

describe("fallbackContactUrls", () => {
  it("selects CRAE Group contact URL over similar-company results", () => {
    const out = fallbackContactUrls("CRAE GROUP LTD", [
      {
        title: "CRAE GROUP LTD - Contact Us",
        url: "https://www.craegroup.com/contact",
        displayUrl: "https://www.craegroup.com/contact",
        snippet: "Contact CRAE GROUP LTD for enquiries.",
        summary: "Official contact page.",
      },
      {
        title: "CRA Group Jobs",
        url: "https://jobs.cra-group.example/contact",
        displayUrl: "jobs.cra-group.example/contact",
        snippet: "Open jobs at a similarly named company.",
        summary: "",
      },
      {
        title: "LinkedIn CRAE Group",
        url: "https://www.linkedin.com/company/crae-group",
        displayUrl: "linkedin.com/company/crae-group",
        snippet: "Social profile.",
        summary: "",
      },
      {
        title: "Craegroup Home",
        url: "https://www.craegroup.com/",
        displayUrl: "craegroup.com",
        snippet: "Official website.",
        summary: "",
      },
    ]);

    expect(out[0]).toBe("https://www.craegroup.com/contact");
    expect(out).not.toContain("https://www.linkedin.com/company/crae-group");
  });
});
