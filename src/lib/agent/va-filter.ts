import type { RawPosting } from "@/types";
import {
  isLikelyTargetRole,
  isUsOrEuropeFriendlyText,
} from "@/lib/job-relevance";

/**
 * Keyword pre-filter for virtual-assistant / remote support style roles
 * in US or European companies. We keep it lenient so the downstream LLM
 * can do the final relevance call, but cheap enough to drop obviously
 * unrelated postings (senior engineer, infra, etc) before paying for LLM.
 */
export function isLikelyVaRole(posting: {
  title: string;
  description: string;
}): boolean {
  return isLikelyTargetRole(posting);
}

export function isUsOrEuropeFriendly(posting: {
  location: string;
  description: string;
}): boolean {
  return isUsOrEuropeFriendlyText(posting);
}

export function filterVaPostings(postings: RawPosting[]): RawPosting[] {
  return postings.filter(
    (p) => isLikelyVaRole(p) && isUsOrEuropeFriendly(p)
  );
}
