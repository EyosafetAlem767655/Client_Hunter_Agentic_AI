/**
 * The software / AI / data roles the user scrapes one at a time, per country.
 * Single source of truth for the Settings per-position scrape tables.
 *
 * - `linkedinQuery`: keyword sent to the LinkedIn scraper. Remote is enforced by
 *   the scraper's `f_WT=2` filter, so the title alone is enough.
 * - `indeedUrl`: the user's exact Indeed search for the role. The server derives
 *   its Indeed `q` from this URL (see indeedQueryFromUrl); tracking params are
 *   ignored. Indeed is USA-only.
 */
export interface JobPosition {
  id: string;
  label: string;
  linkedinQuery: string;
  indeedUrl: string;
}

export const JOB_POSITIONS: JobPosition[] = [
  {
    id: "frontend-developer",
    label: "Frontend Developer",
    linkedinQuery: "front end developer",
    indeedUrl: "https://www.indeed.com/jobs?q=front+end+developer+remote&l=USA+remote&radius=35&from=searchOnDesktopSerp%2Cwhatautocomplete%2CwhatautocompleteSourceStandard&vjk=4ed791b5fce97e51",
  },
  {
    id: "backend-developer",
    label: "Backend Developer",
    linkedinQuery: "backend developer",
    indeedUrl: "https://www.indeed.com/jobs?q=backend+developer+remote&l=USA+remote&radius=0&sc=0kf%3Aattr%28DSQF7%29%3B&from=searchOnDesktopSerp&vjk=f3abe14b1e5aaf52",
  },
  {
    id: "fullstack-developer",
    label: "Fullstack Developer",
    linkedinQuery: "full stack developer",
    indeedUrl: "https://www.indeed.com/jobs?q=Fullstack+developer+remote&l=USA+remote&radius=0&from=searchOnDesktopSerp&vjk=6d2a0fee712096d1",
  },
  {
    id: "software-engineer",
    label: "Software Engineer",
    linkedinQuery: "software engineer",
    indeedUrl: "https://www.indeed.com/jobs?q=Software+engineer+remote&l=USA+remote&radius=0&from=searchOnDesktopSerp&vjk=e119385322e25bb7",
  },
  {
    id: "ai-engineer",
    label: "AI Engineer",
    linkedinQuery: "AI engineer",
    indeedUrl: "https://www.indeed.com/jobs?q=AI+Engineer+remote&l=USA+remote&radius=0&from=searchOnDesktopSerp&vjk=7b630826288e449b",
  },
  {
    id: "machine-learning-engineer",
    label: "Machine Learning Engineer",
    linkedinQuery: "machine learning engineer",
    indeedUrl: "https://www.indeed.com/jobs?q=Machine+learning+Engineer+remote&l=USA+remote&radius=0&from=searchOnDesktopSerp",
  },
  {
    id: "ai-automation-specialist",
    label: "AI Automation Specialist",
    linkedinQuery: "AI automation specialist",
    indeedUrl: "https://www.indeed.com/jobs?q=AI+automation+specialist+remote&l=USA+remote&radius=0&from=searchOnDesktopSerp&vjk=92120b73e12dd11a",
  },
  {
    id: "mern-stack-developer",
    label: "MERN Stack Developer",
    linkedinQuery: "MERN stack developer",
    indeedUrl: "https://www.indeed.com/jobs?q=MERN+stack+developer+remote&l=USA+remote&radius=0&from=searchOnDesktopSerp&vjk=2abbf11507c7b9fd",
  },
  {
    id: "data-scientist",
    label: "Data Scientist",
    linkedinQuery: "data scientist",
    indeedUrl: "https://www.indeed.com/jobs?q=Data+scientist+remote&l=USA+remote&radius=0&from=searchOnDesktopSerp&vjk=45dbefa6eaa55f58",
  },
  {
    id: "data-analyst",
    label: "Data Analyst",
    linkedinQuery: "data analyst",
    indeedUrl: "https://www.indeed.com/jobs?q=Data+Analyst+remote&l=USA+remote&radius=0&from=searchOnDesktopSerp&vjk=ea4b96ad05cd38b3",
  },
];

/**
 * Countries to scrape, and which sources apply to each. LinkedIn runs for all
 * three (keyed by `linkedinLocation`); Indeed is USA-only because clearing its
 * Cloudflare check needs a real browser we only drive locally.
 */
export interface ScrapeCountry {
  id: "usa" | "uk" | "canada";
  label: string;
  /** LinkedIn guest-API `location=` value. */
  linkedinLocation: string;
  sources: ("indeed" | "linkedin")[];
}

export const SCRAPE_COUNTRIES: ScrapeCountry[] = [
  { id: "usa",    label: "USA",    linkedinLocation: "United States",  sources: ["indeed", "linkedin"] },
  { id: "uk",     label: "UK",     linkedinLocation: "United Kingdom", sources: ["linkedin"] },
  { id: "canada", label: "Canada", linkedinLocation: "Canada",         sources: ["linkedin"] },
];

/** Resolve a country id to its LinkedIn `location=` value (defaults to USA). */
export function linkedinLocationForCountry(countryId: string | undefined): string {
  return (
    SCRAPE_COUNTRIES.find((c) => c.id === countryId)?.linkedinLocation ??
    "United States"
  );
}

/** Extract the decoded `q` search term from an Indeed search URL. */
export function indeedQueryFromUrl(url: string): string {
  try {
    return new URL(url).searchParams.get("q")?.trim() ?? "";
  } catch {
    return "";
  }
}
