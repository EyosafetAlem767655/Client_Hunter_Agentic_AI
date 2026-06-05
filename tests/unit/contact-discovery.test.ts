import { describe, expect, it, vi } from "vitest";
import {
  discoverFromBody,
  discoverByPatternGuess,
  extractEmailsFromText,
} from "@/lib/contact/discovery";

describe("contact discovery", () => {
  it("extracts email from body with high confidence", () => {
    const contacts = discoverFromBody(
      "Reach us at hiring@acme.com or mailto:jobs@acme.com"
    );
    expect(contacts.length).toBeGreaterThan(0);
    expect(contacts[0].confidence).toBe(0.9);
    expect(contacts[0].sourceType).toBe("listed");
  });

  it("scrapes company site paths and ranks role-based emails higher", async () => {
    const { discoverFromCompanySite } = await import(
      "@/lib/contact/discovery"
    );
    const html = "<p>Contact careers@acmestartup.io today</p>";
    const contacts = await discoverFromCompanySite(
      "https://acmestartup.io",
      async () => html
    );
    expect(contacts.length).toBeGreaterThan(0);
    expect(contacts[0].email).toBe("careers@acmestartup.io");
    expect(contacts[0].confidence).toBeGreaterThan(0.7);
    expect(contacts[0].sourceType).toBe("scraped_from_site");
  });

  it("pattern guess disabled by default", () => {
    expect(discoverByPatternGuess("https://acme.com/about")).toEqual([]);
  });

  it("regex extracts bare emails", () => {
    const emails = extractEmailsFromText("team@startup.io");
    expect(emails).toContain("team@startup.io");
  });
});
