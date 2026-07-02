/**
 * Canonical list of medical VA job titles to search for.
 * All scrapers that support keyword queries import this list.
 * Titles are stored in plain lowercase English; each scraper
 * transforms them (URL-encode, replace spaces, etc.) as needed.
 */
export const MEDICAL_VA_TITLES = [
  // Reception / front-desk
  "medical receptionist",
  "front desk receptionist",
  "front office coordinator",
  "dental receptionist",
  "dental front office",

  // Patient services
  "patient service representative",
  "patient services coordinator",
  "patient access representative",
  "patient coordinator",
  "patient care coordinator",
  "patient intake specialist",
  "intake coordinator",
  "patient follow-up coordinator",
  "patient recall coordinator",

  // Scheduling
  "appointment scheduler",
  "scheduling coordinator",

  // Medical admin / office
  "medical administrative assistant",
  "medical office assistant",
  "medical secretary",
  "office coordinator medical",
  "office administrator medical",

  // Records / data entry
  "medical records clerk",
  "health information clerk",
  "data entry clerk medical",

  // Insurance / auth
  "insurance verification specialist",
  "eligibility benefits verification",
  "prior authorization specialist",
  "authorization coordinator",

  // Billing / RCM
  "medical biller",
  "medical billing specialist",
  "medical billing and coding",
  "accounts receivable medical",
  "ar specialist medical",
  "claims processor medical",
  "medical claims specialist",
  "revenue cycle specialist",
  "collections specialist medical",

  // Referral
  "referral coordinator",
  "referral specialist",
] as const;

/** Tags used by the Jobicy API (hyphenated slugs). */
export const JOBICY_TAGS = [
  "healthcare",
  "medical",
  "medical-billing",
  "medical-records",
  "patient-services",
  "patient-coordinator",
  "medical-receptionist",
  "prior-authorization",
  "insurance-verification",
  "revenue-cycle",
  "dental",
  "front-desk",
  "scheduling",
  "billing",
  "claims",
  "accounts-receivable",
  "administrative",
  "receptionist",
  "eligibility",
  "referral",
] as const;
