import type { RawPosting } from "@/types";

const TITLE_KEYWORDS = [
  "virtual assistant",
  "executive assistant",
  "administrative assistant",
  "admin assistant",
  "personal assistant",
  "remote assistant",
  "customer support",
  "customer service",
  "customer success",
  "customer care",
  "customer experience",
  "customer operations",
  "customer advocate",
  "client services",
  "client service",
  "client support",
  "client success",
  "member support",
  "member experience",
  "support specialist",
  "support agent",
  "support representative",
  "support associate",
  "technical support",
  "application support",
  "help desk",
  "helpdesk",
  "service desk",
  "chat support",
  "email support",
  "phone support",
  "operations assistant",
  "operations coordinator",
  "ops assistant",
  "project coordinator",
  "office assistant",
  "back office",
  "receptionist",
  "scheduler",
  "scheduling coordinator",
  "appointment setter",
  "data entry",
  "data processor",
  "lead generation",
  "sales development representative",
  "sdr",
  "account coordinator",
  "sales coordinator",
  "social media manager",
  "social media assistant",
  "content coordinator",
  "content moderator",
  "community support",
  "community manager",
  "recruiting coordinator",
  "hr assistant",
  "hr coordinator",
  "talent sourcer",
  "finance assistant",
  "billing specialist",
  "bookkeeping assistant",
  "bookkeeper",
  "accounts payable",
  "accounts receivable",
  "invoicing assistant",
  "onboarding specialist",
];

const BODY_KEYWORDS = [
  ...TITLE_KEYWORDS,
  "administrative",
  "calendar management",
  "inbox management",
  "appointment setting",
  "live chat",
  "support tickets",
  "customer tickets",
  "zendesk",
  "intercom",
  "hubspot",
  "crm",
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
  return needles.some((needle) => lower.includes(needle));
}

export function targetRoleScore(posting: {
  title: string;
  description: string;
}): number {
  let score = 0;
  if (containsAny(posting.title, TITLE_KEYWORDS)) score += 3;
  if (containsAny(posting.description, BODY_KEYWORDS)) score += 1;
  return score;
}

export function isLikelyTargetRole(posting: {
  title: string;
  description: string;
}): boolean {
  return targetRoleScore(posting) > 0;
}

export function isUsOrEuropeFriendlyText(posting: {
  location: string;
  description: string;
}): boolean {
  return containsAny(`${posting.location} ${posting.description}`, US_EU_HINTS);
}

export function prioritizeTargetPostings<T extends RawPosting>(
  postings: T[],
  limit: number
): T[] {
  return postings
    .map((posting, index) => ({
      posting,
      index,
      score: targetRoleScore(posting),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ posting }) => posting);
}
