import { describe, expect, it } from "vitest";
import { filterTechPostings, filterVaPostings } from "@/lib/agent/va-filter";
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

describe("filterTechPostings (tech pre-filter)", () => {
  it("keeps the target software/AI/data titles", () => {
    const postings = [
      p({ title: "Frontend Developer" }),
      p({ title: "Backend Developer" }),
      p({ title: "Full Stack Engineer" }),
      p({ title: "Software Engineer" }),
      p({ title: "AI Engineer" }),
      p({ title: "Machine Learning Engineer" }),
      p({ title: "AI Automation Specialist" }),
      p({ title: "MERN Stack Developer" }),
      p({ title: "Data Scientist" }),
      p({ title: "Data Analyst" }),
    ];
    expect(filterTechPostings(postings)).toHaveLength(postings.length);
  });

  it("keeps postings with tech keywords only in the description", () => {
    const postings = [
      p({ title: "Remote Contributor", description: "Build React and Node services in TypeScript." }),
      p({ title: "Specialist", description: "You will own our machine learning pipeline in Python." }),
    ];
    expect(filterTechPostings(postings)).toHaveLength(2);
  });

  it("drops unrelated professions", () => {
    const postings = [
      p({ title: "Medical Receptionist" }),
      p({ title: "Account Executive" }),
      p({ title: "Registered Nurse" }),
      p({ title: "Warehouse Associate" }),
    ];
    expect(filterTechPostings(postings)).toHaveLength(0);
  });

  it("mixed: keeps tech, drops the rest", () => {
    const postings = [
      p({ title: "Senior Backend Engineer" }),
      p({ title: "Medical Receptionist" }),
      p({ title: "Data Scientist" }),
      p({ title: "Sales Manager" }),
    ];
    const out = filterTechPostings(postings);
    expect(out.map((j) => j.title)).toEqual(["Senior Backend Engineer", "Data Scientist"]);
  });

  it("still exports the legacy filterVaPostings alias", () => {
    expect(filterVaPostings).toBe(filterTechPostings);
  });
});
