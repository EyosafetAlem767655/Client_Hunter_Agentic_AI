const REMOTE_SIGNAL =
  /\b(?:fully remote|100% remote|remote|work from home|work from anywhere|telecommut(?:e|ing)|distributed team)\b/i;

const GLOBAL_SIGNAL =
  /\b(?:worldwide|work from anywhere|anywhere in the world|global(?:ly)?|international applicants?|international candidates?)\b/i;

const IN_PERSON_SIGNAL =
  /\b(?:hybrid|on[- ]?site|in[- ]office|in person|office days?|report to (?:an?|the|our) office|relocation required|must relocate|local candidates only|no remote|not a remote position)\b/i;

const LOCATION_RESTRICTION_PATTERNS = [
  /\b(?:must|required to|need to)\s+(?:currently\s+)?(?:live|reside|be located|be based|work)\s+(?:in|within)\b/i,
  /\b(?:candidates?|applicants?|employees?)\s+(?:must|should|need to|required to)\s+(?:currently\s+)?(?:live|reside|be located|be based|work)\s+(?:in|within)\b/i,
  /\b(?:remote|work from home)\s+(?:only\s+)?(?:in|within|from|for residents? of)\b/i,
  /\b(?:open to|accepting|considering)\s+(?:only\s+)?(?:candidates|applicants)\s+(?:only\s+)?(?:in|from|within)\b/i,
  /\b(?:position|role|opportunity)\s+is\s+(?:only\s+)?(?:open|available)\s+to\s+(?:candidates|applicants|residents|workers)\s+(?:located|residing|living|based)?\s*(?:in|within|from)\b/i,
  /\b(?:residents?|candidates|applicants)\s+(?:of|in|from)\s+[^.!?\n]{0,60}\bonly\b/i,
  /\b(?:restricted|limited)\s+to\s+(?:candidates|applicants|residents|workers)\s+(?:in|from|within)\b/i,
  /\b(?:residency|residence)\s+(?:in|within)\s+[^.!?\n]{1,60}\s+required\b/i,
  /\b(?:eligible|approved)\s+states?\b/i,
  /\bremote[- ]+(?:us|usa|united states|uk|united kingdom|canada|europe|eu|emea)(?:[- ]+only)?\b/i,
  /\b(?:us|usa|united states|uk|united kingdom|canada|europe|eu|emea)[- ]based\s+(?:candidates|applicants|residents|workers)\b/i,
];

export interface RemoteEligibilityPosting {
  title: string;
  location: string;
  description: string;
}

/** Return a hard remote-policy failure, or null when the role can proceed. */
export function findRemoteDisqualifier(
  posting: RemoteEligibilityPosting
): string | null {
  const text = `${posting.title}\n${posting.location}\n${posting.description}`;

  const inPerson = text.match(IN_PERSON_SIGNAL)?.[0];
  if (inPerson) return `Not fully remote: posting contains "${inPerson}".`;

  if (!REMOTE_SIGNAL.test(text)) {
    return "Not confirmed fully remote: the posting contains no explicit remote-work signal.";
  }

  for (const pattern of LOCATION_RESTRICTION_PATTERNS) {
    const restriction = text.match(pattern)?.[0];
    if (restriction) {
      return `Remote role has a geographic presence restriction: "${restriction}".`;
    }
  }

  if (!GLOBAL_SIGNAL.test(text)) {
    // Job boards commonly encode restrictions directly in the location field,
    // for example "Remote - Texas" or "California (Remote)".
    const residualLocation = posting.location
      .replace(REMOTE_SIGNAL, "")
      .replace(/[()\[\],|/\-–—:]+/g, " ")
      .trim();
    if (REMOTE_SIGNAL.test(posting.location) && residualLocation.length > 1) {
      return `Remote role is limited to the listed location: "${posting.location.trim()}".`;
    }
  }

  return null;
}
