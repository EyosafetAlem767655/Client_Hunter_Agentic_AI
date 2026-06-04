import { describe, expect, it } from "vitest";
import {
  filterVaPostings,
  isLikelyVaRole,
  isUsOrEuropeFriendly,
} from "@/lib/agent/va-filter";
import type { RawPosting } from "@/types";

function p(overrides: Partial<RawPosting>): RawPosting {
  return {
    source: "remoteok",
    externalId: "x",
    url: "https://example.com",
    title: "",
    company: "Co",
    location: "Remote",
    description: "",
    postedAt: null,
    raw: {},
    ...overrides,
  };
}

describe("va-filter", () => {
  it("matches virtual assistant titles", () => {
    expect(isLikelyVaRole(p({ title: "Virtual Assistant" }))).toBe(true);
    expect(isLikelyVaRole(p({ title: "Executive Assistant" }))).toBe(true);
    expect(isLikelyVaRole(p({ title: "Customer Support Agent" }))).toBe(true);
  });

  it("rejects engineering / senior tech roles", () => {
    expect(isLikelyVaRole(p({ title: "Senior Rust Engineer" }))).toBe(false);
    expect(isLikelyVaRole(p({ title: "Staff ML Researcher" }))).toBe(false);
  });

  it("matches US and EU locations", () => {
    expect(isUsOrEuropeFriendly(p({ location: "US Remote" }))).toBe(true);
    expect(isUsOrEuropeFriendly(p({ location: "Germany" }))).toBe(true);
    expect(isUsOrEuropeFriendly(p({ location: "Worldwide" }))).toBe(true);
  });

  it("filterVaPostings keeps only VA + US/EU postings", () => {
    const postings = [
      p({ title: "Virtual Assistant", location: "US Only" }),
      p({ title: "Customer Support", location: "Berlin, Germany" }),
      p({ title: "Senior Rust Engineer", location: "US Only" }),
      p({ title: "Virtual Assistant", location: "Mars" }),
    ];
    const out = filterVaPostings(postings);
    expect(out).toHaveLength(2);
  });
});
