import { describe, expect, it } from "vitest";
import { filterVaPostings } from "@/lib/agent/va-filter";
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

describe("filterVaPostings (medical pre-filter)", () => {
  it("keeps medical admin titles", () => {
    const postings = [
      p({ title: "Medical Receptionist" }),
      p({ title: "Patient Coordinator" }),
      p({ title: "Medical Billing Specialist" }),
      p({ title: "Prior Authorization Specialist" }),
      p({ title: "Insurance Verification Specialist" }),
      p({ title: "Dental Receptionist" }),
      p({ title: "Revenue Cycle Specialist" }),
    ];
    expect(filterVaPostings(postings)).toHaveLength(7);
  });

  it("keeps postings with medical keywords in description", () => {
    const postings = [
      p({ title: "Remote Coordinator", description: "You will verify eligibility and handle prior authorization requests." }),
      p({ title: "Office Admin", description: "Experience with medical records and EHR required." }),
    ];
    expect(filterVaPostings(postings)).toHaveLength(2);
  });

  it("drops unrelated roles", () => {
    const postings = [
      p({ title: "Senior Rust Engineer" }),
      p({ title: "Staff ML Researcher" }),
      p({ title: "DevOps Architect" }),
      p({ title: "Product Manager" }),
    ];
    expect(filterVaPostings(postings)).toHaveLength(0);
  });

  it("mixed: keeps medical, drops tech", () => {
    const postings = [
      p({ title: "Medical Receptionist" }),
      p({ title: "Senior Backend Engineer" }),
      p({ title: "Referral Coordinator" }),
      p({ title: "Data Scientist" }),
    ];
    const out = filterVaPostings(postings);
    expect(out).toHaveLength(2);
    expect(out.map((j) => j.title)).toEqual(["Medical Receptionist", "Referral Coordinator"]);
  });
});
