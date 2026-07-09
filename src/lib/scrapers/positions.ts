/**
 * The medical-admin / VA positions the user scrapes one at a time (USA Remote).
 * Single source of truth for the Settings per-position scrape tables.
 *
 * - `linkedinQuery`: keyword sent to the LinkedIn scraper (US remote).
 * - `indeedUrl`: the exact Indeed search the button opens in the user's browser
 *   tab. The server derives its Indeed `q` from this URL (see indeedQueryFromUrl).
 */
export interface JobPosition {
  id: string;
  label: string;
  linkedinQuery: string;
  indeedUrl: string;
}

export const JOB_POSITIONS: JobPosition[] = [
  {
    id: "medical-receptionist",
    label: "Medical Receptionist",
    linkedinQuery: "medical receptionist",
    indeedUrl: "https://www.indeed.com/jobs?q=Medical+Receptionist&l=USA&sort=date&vjk=7f5c4c80561ea957",
  },
  {
    id: "front-office-coordinator",
    label: "Front Office Coordinator",
    linkedinQuery: "front office coordinator",
    indeedUrl: "https://www.indeed.com/jobs?q=Front+Desk+Receptionist&l=USA&sort=date&vjk=ecc87fe9268f2c8d",
  },
  {
    id: "patient-services-coordinator",
    label: "Patient Services Coordinator",
    linkedinQuery: "patient services coordinator",
    indeedUrl: "https://www.indeed.com/jobs?q=Patient+Service+Representative&l=USA&fromage=1&from=searchOnDesktopSerp&vjk=7b9d4513bc933ad4",
  },
  {
    id: "scheduling-coordinator",
    label: "Scheduling Coordinator",
    linkedinQuery: "scheduling coordinator",
    indeedUrl: "https://www.indeed.com/jobs?q=Appointment+Scheduler&l=USA&fromage=1&from=searchOnDesktopSerp&vjk=dfb03dbaf5ca32ae",
  },
  {
    id: "medical-administrative-assistant",
    label: "Medical Administrative Assistant",
    linkedinQuery: "medical administrative assistant",
    indeedUrl: "https://www.indeed.com/jobs?q=medical+administrative+assistant&l=USA&fromage=1&from=searchOnDesktopSerp&vjk=8d062977bbc442b1",
  },
  {
    id: "data-entry-clerk-medical",
    label: "Data Entry Clerk (Medical)",
    linkedinQuery: "data entry clerk medical",
    indeedUrl: "https://www.indeed.com/jobs?q=data+entry+clerk+remote&l=USA&from=searchOnDesktopSerp%2CrelatedQueries&vjk=58d0785893215f3f",
  },
  {
    id: "insurance-verification-specialist",
    label: "Insurance Verification Specialist",
    linkedinQuery: "insurance verification specialist",
    indeedUrl: "https://www.indeed.com/jobs?q=Insurance+Verification+Specialist+remote&l=USA&sort=date&vjk=8872c9b2287ef3bf",
  },
  {
    id: "medical-biller",
    label: "Medical Biller / Billing Specialist",
    linkedinQuery: "medical biller",
    indeedUrl: "https://www.indeed.com/jobs?q=medical+biller+remote&l=USA&sort=date&vjk=9a335a6c88c91e53",
  },
  {
    id: "accounts-receivable-medical",
    label: "Accounts Receivable / AR Specialist",
    linkedinQuery: "accounts receivable medical",
    indeedUrl: "https://www.indeed.com/jobs?q=Accounts+Receivable+remote&l=USA&sort=date&vjk=91bc5ff769ca803a",
  },
  {
    id: "claims-processor",
    label: "Claims Processor",
    linkedinQuery: "claims processor medical",
    indeedUrl: "https://www.indeed.com/jobs?q=Claims+Processor++remote&l=USA&sort=date&vjk=250e3276b9a1b978",
  },
  {
    id: "medical-claims-specialist",
    label: "Medical Claims Specialist",
    linkedinQuery: "medical claims specialist",
    indeedUrl: "https://www.indeed.com/jobs?q=Medical%20Claims%20Specialist%20remote&l=USA&sort=date",
  },
  {
    id: "revenue-cycle-specialist",
    label: "Revenue Cycle Specialist",
    linkedinQuery: "revenue cycle specialist",
    indeedUrl: "https://www.indeed.com/jobs?q=Revenue+Cycle+Specialist+remote&l=USA&sort=date&vjk=53a728fa159aad04",
  },
  {
    id: "collections-specialist-medical",
    label: "Collections Specialist",
    linkedinQuery: "collections specialist medical",
    indeedUrl: "https://www.indeed.com/jobs?q=Collections+Specialist+remote&l=USA&sort=date&vjk=a1671ed14b42e080",
  },
  {
    id: "referral-specialist",
    label: "Referral Coordinator / Specialist",
    linkedinQuery: "referral specialist",
    indeedUrl: "https://www.indeed.com/jobs?q=Referral+Specialist+remote&l=USA&sort=date&vjk=00fa00a1e7c6e7fd",
  },
  {
    id: "dental-receptionist",
    label: "Dental Receptionist / Front Office",
    linkedinQuery: "dental receptionist",
    indeedUrl: "https://www.indeed.com/jobs?q=Dental+Receptionist+remote&l=USA&sort=date&vjk=dc98d8de01f95a14",
  },
  {
    id: "recall-coordinator",
    label: "Patient Follow-up / Recall Coordinator",
    linkedinQuery: "recall coordinator",
    indeedUrl: "https://www.indeed.com/jobs?q=Recall+Coordinator+remote&l=USA&sort=date&vjk=b1e7bc98eea2cd33",
  },
  {
    id: "virtual-assistant",
    label: "Virtual Assistant",
    linkedinQuery: "virtual assistant",
    indeedUrl: "https://www.indeed.com/jobs?q=Virtual+Assistant+remote&l=USA&sort=date&vjk=3bc62d61c27d48cf",
  },
];

/** Extract the decoded `q` search term from an Indeed search URL. */
export function indeedQueryFromUrl(url: string): string {
  try {
    return new URL(url).searchParams.get("q")?.trim() ?? "";
  } catch {
    return "";
  }
}
