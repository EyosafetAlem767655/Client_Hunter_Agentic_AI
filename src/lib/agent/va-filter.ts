import type { RawPosting } from "@/types";

// Cheap keyword gate that runs before the LLM. Its job is to drop obviously
// unrelated postings that come off broad remote job boards (the per-position
// LinkedIn/Indeed searches are already role-targeted and sail through). Keep it
// generous — the LLM makes the real relevance call.
const TECH_PRE_FILTER_KEYWORDS = [
  "developer", "engineer", "software", "programmer", "programming",
  "frontend", "front end", "front-end", "backend", "back end", "back-end",
  "full stack", "fullstack", "full-stack", "web developer",
  "mern", "react", "node", "javascript", "typescript", "python", "java",
  "data scientist", "data science", "data analyst", "data analytics", "analytics",
  "machine learning", "deep learning", "ml engineer", " ml ",
  "ai engineer", "artificial intelligence", " ai ", "ai/ml", "genai", "llm",
  "automation", "devops", "cloud", "api",
];

export function filterTechPostings(postings: RawPosting[]): RawPosting[] {
  return postings.filter((p) => {
    // Pad so " ai " / " ml " word-boundary checks also match at the edges.
    const lower = ` ${(p.title + " " + p.description).toLowerCase()} `;
    return TECH_PRE_FILTER_KEYWORDS.some((kw) => lower.includes(kw));
  });
}

/** @deprecated Back-compat alias — the pre-filter now targets tech roles. */
export const filterVaPostings = filterTechPostings;
