import { describe, expect, it } from "vitest";
import { findRemoteDisqualifier } from "@/lib/llm/remote-eligibility";

const posting = (location: string, description: string) => ({
  title: "Software Engineer",
  location,
  description,
});

describe("remote eligibility gate", () => {
  it("accepts an explicitly worldwide remote role", () => {
    expect(
      findRemoteDisqualifier(
        posting("Worldwide", "This is a fully remote role open to international applicants.")
      )
    ).toBeNull();
  });

  it("accepts a plain remote role without a presence restriction", () => {
    expect(
      findRemoteDisqualifier(posting("Remote", "Join our distributed engineering team."))
    ).toBeNull();
  });

  it("rejects a state encoded in the remote location field", () => {
    expect(
      findRemoteDisqualifier(posting("Remote - Texas", "This is a remote role."))
    ).toContain("limited to the listed location");
  });

  it("rejects an explicit state residency requirement", () => {
    expect(
      findRemoteDisqualifier(
        posting("Remote", "Candidates must reside in California to perform this remote role.")
      )
    ).toContain("geographic presence restriction");
  });

  it.each([
    "This remote position is open to candidates residing in the following states: Texas and Florida.",
    "This is a remote-US-only engineering position.",
    "Applicants must live in one of our approved states.",
    "This remote role accepts US-based candidates.",
  ])("rejects common geographic restriction wording", (description) => {
    expect(findRemoteDisqualifier(posting("Remote", description))).toContain(
      "geographic presence restriction"
    );
  });

  it("does not let a global phrase override an explicit restriction", () => {
    expect(
      findRemoteDisqualifier(
        posting("Remote", "We are global, but applicants must be located in New York.")
      )
    ).toContain("geographic presence restriction");
  });

  it("rejects hybrid and on-site roles", () => {
    expect(
      findRemoteDisqualifier(posting("Remote", "Hybrid with two office days each week."))
    ).toContain("Not fully remote");
  });

  it("rejects roles with no explicit remote signal", () => {
    expect(
      findRemoteDisqualifier(posting("New York", "Build APIs for our product."))
    ).toContain("Not confirmed fully remote");
  });
});
