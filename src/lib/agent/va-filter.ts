import type { RawPosting } from "@/types";

const MEDICAL_PRE_FILTER_KEYWORDS = [
  "medical", "patient", "receptionist", "front desk", "front office",
  "appointment scheduler", "scheduling coordinator", "insurance verification",
  "prior authorization", "medical billing", "medical biller",
  "revenue cycle", "claims", "referral coordinator", "dental",
  "eligibility", "intake coordinator", "health information",
  "medical records", "medical administrative",
];

export function filterVaPostings(postings: RawPosting[]): RawPosting[] {
  return postings.filter((p) => {
    const lower = (p.title + " " + p.description).toLowerCase();
    return MEDICAL_PRE_FILTER_KEYWORDS.some((kw) => lower.includes(kw));
  });
}
