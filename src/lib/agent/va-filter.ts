import type { RawPosting } from "@/types";

/**
 * Keyword pre-filter for virtual-assistant / remote support style roles
 * in US or European companies. We keep it lenient so the downstream LLM
 * can do the final relevance call, but cheap enough to drop obviously
 * unrelated postings (senior engineer, infra, etc) before paying for LLM.
 */
const VA_TITLE_KEYWORDS = [
  "virtual assistant",
  "executive assistant",
  "administrative assistant",
  "admin assistant",
  "personal assistant",
  "remote assistant",
  "customer support",
  "customer service",
  "customer success",
  "support specialist",
  "support agent",
  "support representative",
  "operations assistant",
  "ops assistant",
  "data entry",
  "scheduler",
  "coordinator",
  "social media manager",
  "social media assistant",
  "content moderator",
  "chat support",
  "client services",
  "client support",
  "back office",
  "help desk",
  "helpdesk",
  "office assistant",
  "receptionist",
  "appointment setter",
  "lead generation",
];

const VA_BODY_KEYWORDS = [
  "virtual assistant",
  "executive assistant",
  "administrative",
  "customer support",
  "customer service",
  "data entry",
  "calendar management",
  "inbox management",
  "appointment setting",
];

const US_EU_HINTS = [
  "united states",
  "usa",
  "u.s.",
  "us only",
  "us-based",
  "us based",
  "us remote",
  "north america",
  "americas",
  "europe",
  "european",
  "eu",
  "uk",
  "united kingdom",
  "england",
  "germany",
  "france",
  "ireland",
  "netherlands",
  "spain",
  "portugal",
  "italy",
  "poland",
  "sweden",
  "norway",
  "denmark",
  "finland",
  "emea",
  "anywhere",
  "worldwide",
  "remote",
  "global",
];

function containsAny(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((n) => lower.includes(n));
}

export function isLikelyVaRole(posting: {
  title: string;
  description: string;
}): boolean {
  if (containsAny(posting.title, VA_TITLE_KEYWORDS)) return true;
  // Some boards put the role in the description only
  if (containsAny(posting.description, VA_BODY_KEYWORDS)) return true;
  return false;
}

export function isUsOrEuropeFriendly(posting: {
  location: string;
  description: string;
}): boolean {
  const combined = `${posting.location} ${posting.description}`;
  return containsAny(combined, US_EU_HINTS);
}

export function filterVaPostings(postings: RawPosting[]): RawPosting[] {
  return postings.filter(
    (p) => isLikelyVaRole(p) && isUsOrEuropeFriendly(p)
  );
}
