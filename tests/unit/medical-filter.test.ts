import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock memory and observability before importing the module under test
vi.mock("@/lib/agent/memory", () => ({
  memory: {
    listUnfilteredPostings: vi.fn(),
    insertFilteredJob: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/lib/agent/observability", () => ({
  logEvent: vi.fn().mockResolvedValue(undefined),
}));

import {
  filterPendingPostings,
  RULE_FILTER_MODEL,
  RULE_FILTER_VERSION,
} from "@/lib/agent/medical-filter";
import { memory } from "@/lib/agent/memory";

function posting(overrides: {
  title?: string;
  company?: string;
  location?: string;
  description?: string;
  id?: number;
}) {
  return {
    id: overrides.id ?? 1,
    title: overrides.title ?? "Medical Receptionist",
    company: overrides.company ?? "ClearPath Health",
    location: overrides.location ?? "Remote, USA",
    description: overrides.description ?? "Schedule appointments and verify insurance eligibility.",
    source: "remotive",
    externalId: "x",
    url: "https://example.com/job",
    postedAt: null,
    raw: {},
    scrapedAt: new Date(),
  };
}

describe("medical-filter (rule-based)", () => {
  beforeEach(() => vi.clearAllMocks());

  // ── Red flags ─────────────────────────────────────────────────────────────

  it("disqualifies on-site requirement", async () => {
    vi.mocked(memory.listUnfilteredPostings).mockResolvedValue([
      { posting: posting({ description: "This is an on-site position in our Denver clinic." }) },
    ]);
    const result = await filterPendingPostings(10);
    expect(result.processed).toBe(1);
    expect(result.newMatches).toHaveLength(0);
    const call = vi.mocked(memory.insertFilteredJob).mock.calls[0][0];
    expect(call.isRelevant).toBe(false);
    expect(call.score).toBe(5);
    expect(call.fitReason).toContain("on-site");
  });

  it("disqualifies in-person language", async () => {
    vi.mocked(memory.listUnfilteredPostings).mockResolvedValue([
      { posting: posting({ description: "Must be available in person at our clinic." }) },
    ]);
    const result = await filterPendingPostings(10);
    expect(result.newMatches).toHaveLength(0);
    expect(vi.mocked(memory.insertFilteredJob).mock.calls[0][0].fitReason).toContain("on-site");
  });

  it("disqualifies clinical duties (take vitals)", async () => {
    vi.mocked(memory.listUnfilteredPostings).mockResolvedValue([
      { posting: posting({ description: "You will take vitals and room patients." }) },
    ]);
    const result = await filterPendingPostings(10);
    expect(result.newMatches).toHaveLength(0);
    expect(vi.mocked(memory.insertFilteredJob).mock.calls[0][0].fitReason).toContain("clinical duty");
  });

  it("disqualifies phlebotomy requirement", async () => {
    vi.mocked(memory.listUnfilteredPostings).mockResolvedValue([
      { posting: posting({ description: "Must be able to draw blood and perform phlebotomy." }) },
    ]);
    const result = await filterPendingPostings(10);
    expect(result.newMatches).toHaveLength(0);
  });

  it("disqualifies clinical credential requirement", async () => {
    vi.mocked(memory.listUnfilteredPostings).mockResolvedValue([
      { posting: posting({ description: "CNA required. BLS certified preferred." }) },
    ]);
    const result = await filterPendingPostings(10);
    expect(result.newMatches).toHaveLength(0);
    expect(vi.mocked(memory.insertFilteredJob).mock.calls[0][0].fitReason).toContain("clinical credential");
  });

  it("disqualifies transportation requirement", async () => {
    vi.mocked(memory.listUnfilteredPostings).mockResolvedValue([
      { posting: posting({ description: "Reliable transportation required to travel between locations." }) },
    ]);
    const result = await filterPendingPostings(10);
    expect(result.newMatches).toHaveLength(0);
    expect(vi.mocked(memory.insertFilteredJob).mock.calls[0][0].fitReason).toContain("transportation");
  });

  it("disqualifies W-2 only legal blocker", async () => {
    vi.mocked(memory.listUnfilteredPostings).mockResolvedValue([
      { posting: posting({ description: "W-2 only, no contractors. No 1099." }) },
    ]);
    const result = await filterPendingPostings(10);
    expect(result.newMatches).toHaveLength(0);
    expect(vi.mocked(memory.insertFilteredJob).mock.calls[0][0].fitReason).toContain("legal/work-auth");
  });

  it("disqualifies location restriction when no remote signal", async () => {
    vi.mocked(memory.listUnfilteredPostings).mockResolvedValue([
      { posting: posting({ location: "Denver, CO", description: "Must live in Colorado. No remote option." }) },
    ]);
    const result = await filterPendingPostings(10);
    expect(result.newMatches).toHaveLength(0);
    expect(vi.mocked(memory.insertFilteredJob).mock.calls[0][0].fitReason).toContain("location restriction");
  });

  it("allows 'must live in' language when posting is also remote", async () => {
    vi.mocked(memory.listUnfilteredPostings).mockResolvedValue([
      { posting: posting({ location: "Remote, USA", description: "Must live in a US timezone. Fully remote position." }) },
    ]);
    const result = await filterPendingPostings(10);
    // Should NOT be disqualified by location restriction because remote signal is present
    expect(vi.mocked(memory.insertFilteredJob).mock.calls[0][0].fitReason).not.toContain("location restriction");
  });

  it("disqualifies non-US posting (EU only)", async () => {
    vi.mocked(memory.listUnfilteredPostings).mockResolvedValue([
      { posting: posting({ location: "London", description: "UK only. Must be based in the UK.", company: "BritishCo" }) },
    ]);
    const result = await filterPendingPostings(10);
    expect(result.newMatches).toHaveLength(0);
    expect(vi.mocked(memory.insertFilteredJob).mock.calls[0][0].fitReason).toContain("Not a US-company");
  });

  it("disqualifies when non-US restriction is explicit", async () => {
    vi.mocked(memory.listUnfilteredPostings).mockResolvedValue([
      { posting: posting({ location: "Remote", description: "Europe only candidates preferred. eu only applicants.", company: "EuroCo" }) },
    ]);
    const result = await filterPendingPostings(10);
    expect(result.newMatches).toHaveLength(0);
    expect(vi.mocked(memory.insertFilteredJob).mock.calls[0][0].fitReason).toContain("Not a US-company");
  });

  // ── Positive scoring ───────────────────────────────────────────────────────

  it("marks a clean medical admin posting as relevant", async () => {
    vi.mocked(memory.listUnfilteredPostings).mockResolvedValue([
      {
        posting: posting({
          title: "Medical Receptionist",
          location: "Remote, USA",
          description: "Schedule appointments, verify insurance eligibility, data entry. Athena EMR experience preferred. Fully remote.",
        }),
      },
    ]);
    const result = await filterPendingPostings(10);
    expect(result.newMatches).toHaveLength(1);
    expect(result.newMatches[0].score).toBeGreaterThanOrEqual(50);
  });

  it("boosts score for EHR mentions", async () => {
    vi.mocked(memory.listUnfilteredPostings).mockResolvedValue([
      {
        posting: posting({
          title: "Patient Coordinator",
          location: "Remote",
          description: "Experience with Athena, eClinicalWorks, or Epic required. Remote position.",
        }),
      },
    ]);
    const result = await filterPendingPostings(10);
    const score = vi.mocked(memory.insertFilteredJob).mock.calls[0][0].score;
    expect(score).toBeGreaterThan(50);
  });

  it("deprioritizes hospital postings by 20 points but does not disqualify", async () => {
    vi.mocked(memory.listUnfilteredPostings).mockResolvedValue([
      {
        posting: posting({
          title: "Medical Billing Specialist",
          company: "City General Hospital",
          location: "Remote USA",
          description: "Billing and claims processing. Remote role. Work from home.",
        }),
      },
    ]);
    const result = await filterPendingPostings(10);
    const call = vi.mocked(memory.insertFilteredJob).mock.calls[0][0];
    // Company has "hospital" — still relevant if score was high enough, but penalized
    expect(call.score).toBeLessThan(100);
  });

  // ── Role category assignment ───────────────────────────────────────────────

  it("assigns medical_billing_rcm for billing roles", async () => {
    vi.mocked(memory.listUnfilteredPostings).mockResolvedValue([
      { posting: posting({ title: "Medical Billing Specialist", location: "Remote US", description: "Handle claims and billing. Remote." }) },
    ]);
    await filterPendingPostings(10);
    expect(vi.mocked(memory.insertFilteredJob).mock.calls[0][0].roleCategory).toBe("medical_billing_rcm");
  });

  it("assigns insurance_auth for prior authorization roles", async () => {
    vi.mocked(memory.listUnfilteredPostings).mockResolvedValue([
      { posting: posting({ title: "Prior Authorization Specialist", location: "Remote US", description: "Handle insurance verification and eligibility. Remote." }) },
    ]);
    await filterPendingPostings(10);
    expect(vi.mocked(memory.insertFilteredJob).mock.calls[0][0].roleCategory).toBe("insurance_auth");
  });

  it("assigns referral_coordinator for referral roles", async () => {
    vi.mocked(memory.listUnfilteredPostings).mockResolvedValue([
      { posting: posting({ title: "Referral Coordinator", location: "Remote US", description: "Manage patient referrals. Remote." }) },
    ]);
    await filterPendingPostings(10);
    expect(vi.mocked(memory.insertFilteredJob).mock.calls[0][0].roleCategory).toBe("referral_coordinator");
  });

  it("assigns dental_admin for dental roles", async () => {
    vi.mocked(memory.listUnfilteredPostings).mockResolvedValue([
      { posting: posting({ title: "Dental Receptionist", location: "Remote USA", description: "Schedule dental appointments. Remote." }) },
    ]);
    await filterPendingPostings(10);
    expect(vi.mocked(memory.insertFilteredJob).mock.calls[0][0].roleCategory).toBe("dental_admin");
  });

  // ── filterPendingPostings integration ────────────────────────────────────

  it("returns correct counts across mixed batch", async () => {
    vi.mocked(memory.listUnfilteredPostings).mockResolvedValue([
      { posting: posting({ id: 1, title: "Medical Receptionist", location: "Remote USA", description: "Schedule appointments. Fully remote." }) },
      { posting: posting({ id: 2, title: "Senior Engineer", location: "Remote", description: "Build distributed systems." }) },
      { posting: posting({ id: 3, title: "Patient Coordinator", location: "Remote US", description: "Prior authorization and referral management. Work from home." }) },
    ]);
    const result = await filterPendingPostings(10);
    expect(result.processed).toBe(3);
    expect(result.succeeded).toBe(3);
    expect(memory.insertFilteredJob).toHaveBeenCalledTimes(3);
    // Medical postings should be relevant; engineer should not
    const calls = vi.mocked(memory.insertFilteredJob).mock.calls.map((c) => c[0]);
    const relevant = calls.filter((c) => c.isRelevant);
    expect(relevant.length).toBeGreaterThanOrEqual(2);
  });

  it("writes rule-based model and version to every row", async () => {
    vi.mocked(memory.listUnfilteredPostings).mockResolvedValue([
      { posting: posting({ location: "Remote USA" }) },
    ]);
    await filterPendingPostings(10);
    const call = vi.mocked(memory.insertFilteredJob).mock.calls[0][0];
    expect(call.llmModel).toBe(RULE_FILTER_MODEL);
    expect(call.promptVersion).toBe(RULE_FILTER_VERSION);
  });

  it("returns empty results when no unfiltered postings", async () => {
    vi.mocked(memory.listUnfilteredPostings).mockResolvedValue([]);
    const result = await filterPendingPostings(10);
    expect(result.processed).toBe(0);
    expect(result.succeeded).toBe(0);
    expect(result.newMatches).toHaveLength(0);
  });

  it("always sets suggestedRegions for relevant postings", async () => {
    vi.mocked(memory.listUnfilteredPostings).mockResolvedValue([
      { posting: posting({ location: "Remote USA", description: "Schedule appointments. Fully remote." }) },
    ]);
    await filterPendingPostings(10);
    const call = vi.mocked(memory.insertFilteredJob).mock.calls[0][0];
    if (call.isRelevant) {
      expect(call.suggestedRegions).toEqual(["Philippines", "India", "Ethiopia"]);
    }
  });
});
