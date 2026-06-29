import { memory } from "./memory";
import { logEvent } from "./observability";

export const RULE_FILTER_MODEL = "rule-based";
export const RULE_FILTER_VERSION = "2.0.0";

// ─── Red flags ─────────────────────────────────────────────────────────────

const RED_FLAG_ONSITE = [
  "on-site", "on site", "in-office", "in office", "in person", "in-person",
  "must report to our office", "local candidates only",
];

// "no remote" is a hard disqualifier checked before remote-signal detection
const RED_FLAG_NO_REMOTE = ["no remote"];

const RED_FLAG_LOCATION_RESTRICTION = [
  "must live in", "us-based only", "us residents only",
];

const RED_FLAG_TRANSPORT = [
  "reliable transportation", "valid driver's license", "driver's license required",
  "travel between locations",
];

const RED_FLAG_CLINICAL = [
  "take vitals", "room patients", "draw blood", "phlebotomy",
  "administer injections", "specimen collection",
  "assist provider with exams", "clinical duties", "clinical rotation",
];

const RED_FLAG_CLINICAL_CREDENTIALS = [
  "cna required", "ma certification required", "bls certified",
  "cpr certified", "scrubs required", "rn required", "lpn required",
];

const RED_FLAG_LEGAL = [
  "must be authorized to work in the us",
  "authorized to work in the united states",
  "w-2 only", "no contractors", "no 1099", "1099 not accepted",
  "fingerprinting in person",
];

// Applied to company field only — deprioritize (−20 pts), not disqualify
const RED_FLAG_COMPANY_TYPE = [
  "hospital", "health system", "medical center", "health sciences",
];

// ─── Green flags ────────────────────────────────────────────────────────────

const GREEN_FLAG_DUTIES = [
  "answer phones", "schedule appointments", "appointment confirmation",
  "appointment reminder", "verify insurance", "verify eligibility",
  "prior authorization", "data entry", "medical records", "billing",
  "claims", "ar follow", "accounts receivable", "collections",
  "referral", "patient intake", "check-in", "check in",
];

const GREEN_FLAG_EHR = [
  "athena", "eclinicalworks", "kareo", "drchrono", "nextgen",
  "epic", "ehr", "emr",
];

const GREEN_FLAG_SCALE = [
  "high call volume", "growing practice", "multiple providers",
  "need to scale", "backlog",
];

const GREEN_FLAG_REMOTE = [
  "remote", "fully remote", "work from home", "virtual",
  "telecommute", "anywhere",
];

// ─── Title matching ─────────────────────────────────────────────────────────

const MEDICAL_TITLES = [
  "medical receptionist", "front desk receptionist", "front office coordinator",
  "patient service representative", "patient services coordinator",
  "patient access representative", "appointment scheduler", "scheduling coordinator",
  "patient coordinator", "patient care coordinator", "patient intake specialist",
  "intake coordinator", "medical administrative assistant", "medical office assistant",
  "medical secretary", "medical records clerk", "health information clerk",
  "data entry clerk", "office coordinator", "office administrator",
  "insurance verification specialist", "eligibility", "benefits verification",
  "prior authorization specialist", "authorization coordinator",
  "medical biller", "medical billing specialist", "medical billing and coding",
  "accounts receivable", "ar specialist", "claims processor", "medical claims",
  "revenue cycle", "collections specialist", "referral coordinator",
  "referral specialist", "dental receptionist", "dental front office",
  "patient follow-up", "recall coordinator",
];

// ─── Location signals ───────────────────────────────────────────────────────

const US_SIGNALS = [
  "united states", "usa", "u.s.", "us only", "us-based", "us based",
  "us remote", "north america", "anywhere", "worldwide", "global", "remote",
];

const NON_US_HARD_RESTRICTIONS = [
  "uk only", "canada only", "australia only", "eu only", "europe only",
];

// ─── Core scoring ───────────────────────────────────────────────────────────

function hasAny(text: string, patterns: string[]): string | null {
  for (const p of patterns) {
    if (text.includes(p)) return p;
  }
  return null;
}

function countMatches(text: string, patterns: string[]): number {
  return patterns.filter((p) => text.includes(p)).length;
}

interface RuleFilterResult {
  isRelevant: boolean;
  score: number;
  roleCategory: string;
  fitReason: string;
  suggestedRegions: string[];
  estimatedSalaryRange: string | null;
}

function applyRuleFilter(posting: {
  title: string;
  company: string;
  location: string;
  description: string;
}): RuleFilterResult {
  const titleLower = posting.title.toLowerCase();
  const companyLower = posting.company.toLowerCase();
  const locationLower = posting.location.toLowerCase();
  const descLower = posting.description.toLowerCase();
  const allText = `${titleLower} ${companyLower} ${locationLower} ${descLower}`;

  const disqualify = (reason: string, score = 5): RuleFilterResult => ({
    isRelevant: false,
    score,
    roleCategory: "disqualified",
    fitReason: reason,
    suggestedRegions: [],
    estimatedSalaryRange: null,
  });

  // Hard disqualifications
  const onsiteHit = hasAny(allText, RED_FLAG_ONSITE);
  if (onsiteHit) return disqualify(`Red flag (on-site): "${onsiteHit}"`);

  const clinicalHit = hasAny(allText, RED_FLAG_CLINICAL);
  if (clinicalHit) return disqualify(`Red flag (clinical duty): "${clinicalHit}"`);

  const credHit = hasAny(allText, RED_FLAG_CLINICAL_CREDENTIALS);
  if (credHit) return disqualify(`Red flag (clinical credential): "${credHit}"`);

  const transportHit = hasAny(allText, RED_FLAG_TRANSPORT);
  if (transportHit) return disqualify(`Red flag (transportation): "${transportHit}"`);

  const legalHit = hasAny(allText, RED_FLAG_LEGAL);
  if (legalHit) return disqualify(`Red flag (legal/work-auth): "${legalHit}"`);

  // "no remote" is a hard disqualifier even if the word "remote" appears elsewhere
  const noRemoteHit = hasAny(allText, RED_FLAG_NO_REMOTE);
  if (noRemoteHit) return disqualify(`Red flag (location restriction, no remote): "${noRemoteHit}"`);

  // Remaining location restrictions only disqualify when no remote signal is present
  const hasRemote = GREEN_FLAG_REMOTE.some((s) => allText.includes(s));
  if (!hasRemote) {
    const locHit = hasAny(allText, RED_FLAG_LOCATION_RESTRICTION);
    if (locHit) return disqualify(`Red flag (location restriction, no remote): "${locHit}"`);
  }

  // US company requirement
  const locationAndDesc = `${locationLower} ${descLower}`;
  const hasUsSignal = US_SIGNALS.some((s) => locationAndDesc.includes(s));
  const hasNonUsRestriction = NON_US_HARD_RESTRICTIONS.some((s) => allText.includes(s));
  if (!hasUsSignal || hasNonUsRestriction) {
    return disqualify("Not a US-company posting", 10);
  }

  // Positive scoring
  let score = 30;

  const titleMatchCount = MEDICAL_TITLES.filter((t) => titleLower.includes(t)).length;
  score += Math.min(30, titleMatchCount * 15);

  const dutyMatchCount = countMatches(descLower, GREEN_FLAG_DUTIES);
  score += Math.min(20, dutyMatchCount * 4);

  const ehrMatchCount = countMatches(descLower, GREEN_FLAG_EHR);
  score += Math.min(10, ehrMatchCount * 5);

  const scaleMatchCount = countMatches(descLower, GREEN_FLAG_SCALE);
  score += Math.min(5, scaleMatchCount * 3);

  if (hasRemote) score += 10;

  // Deprioritize large health systems (not disqualify)
  if (RED_FLAG_COMPANY_TYPE.some((f) => companyLower.includes(f))) {
    score = Math.max(0, score - 20);
  }

  score = Math.min(100, Math.round(score));

  // Role category
  let roleCategory = "medical_admin";
  if (
    titleLower.includes("billing") || titleLower.includes("coder") ||
    titleLower.includes("revenue cycle") || titleLower.includes("claims") ||
    titleLower.includes("accounts receivable") || titleLower.includes("collections")
  ) {
    roleCategory = "medical_billing_rcm";
  } else if (
    titleLower.includes("prior authorization") ||
    titleLower.includes("insurance verification") ||
    titleLower.includes("eligibility")
  ) {
    roleCategory = "insurance_auth";
  } else if (titleLower.includes("referral")) {
    roleCategory = "referral_coordinator";
  } else if (titleLower.includes("dental")) {
    roleCategory = "dental_admin";
  }

  const parts: string[] = [];
  if (titleMatchCount > 0) parts.push("title matches medical admin role");
  if (dutyMatchCount > 0) parts.push(`${dutyMatchCount} admin duty matches`);
  if (ehrMatchCount > 0) parts.push("EHR/EMR mentioned");
  if (hasRemote) parts.push("remote-eligible");
  const fitReason = parts.length > 0 ? parts.join(", ") : "passed red-flag checks";

  return {
    isRelevant: score >= 50,
    score,
    roleCategory,
    fitReason,
    suggestedRegions: ["Philippines", "India", "Ethiopia"],
    estimatedSalaryRange: null,
  };
}

// ─── Public interface (drop-in replacement for reasoning.ts) ───────────────

export interface FilterRunResult {
  processed: number;
  succeeded: number;
  newMatches: NewMatch[];
}

export interface NewMatch {
  postingId: number;
  title: string;
  company: string;
  location: string;
  url: string;
  score: number;
  roleCategory: string | null;
  fitReason: string | null;
  estimatedSalaryRange: string | null;
}

export async function filterPendingPostings(
  limit: number,
  _options: Record<string, unknown> = {}
): Promise<FilterRunResult> {
  const pending = await memory.listUnfilteredPostings(limit);

  let processed = 0;
  let succeeded = 0;
  const newMatches: NewMatch[] = [];

  for (const { posting } of pending) {
    processed++;
    const result = applyRuleFilter(posting);

    await memory.insertFilteredJob({
      postingId: posting.id,
      isRelevant: result.isRelevant,
      score: result.score,
      roleCategory: result.roleCategory,
      fitReason: result.fitReason,
      suggestedRegions: result.suggestedRegions,
      estimatedSalaryRange: result.estimatedSalaryRange,
      llmModel: RULE_FILTER_MODEL,
      promptVersion: RULE_FILTER_VERSION,
    });
    succeeded++;

    if (result.isRelevant) {
      newMatches.push({
        postingId: posting.id,
        title: posting.title,
        company: posting.company,
        location: posting.location,
        url: posting.url,
        score: result.score,
        roleCategory: result.roleCategory,
        fitReason: result.fitReason,
        estimatedSalaryRange: result.estimatedSalaryRange,
      });
    }
  }

  await logEvent("info", "Rule-based medical filter complete", {
    processed,
    succeeded,
    relevant: newMatches.length,
    model: RULE_FILTER_MODEL,
    version: RULE_FILTER_VERSION,
  });

  return { processed, succeeded, newMatches };
}
