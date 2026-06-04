import { env } from "@/lib/env";
import { ArbeitnowScraper } from "./arbeitnow";
import { HnHiringScraper } from "./hn-hiring";
import { JobicyScraper } from "./jobicy";
import { RemoteOkScraper } from "./remoteok";
import { RemotiveScraper } from "./remotive";
import { WeWorkRemotelyScraper } from "./weworkremotely";
import { WwrDomScraper } from "./wwr-dom";
import type { BaseScraper } from "./base";

/**
 * Ordered list of scrapers. We list the most cloud-IP-friendly JSON APIs
 * first (Remotive / Arbeitnow / Jobicy), then the trickier RSS / API sources
 * (WeWorkRemotely RSS, RemoteOK API, HN Hiring), then a DOM/HTML scraper as
 * a last-resort fallback. `Promise.allSettled` in the runner means a single
 * blocked source can't take down the whole run.
 */
export function getEnabledScrapers(): BaseScraper[] {
  const contact = env.CONTACT_EMAIL;
  return [
    new RemotiveScraper(contact),
    new ArbeitnowScraper(contact),
    new JobicyScraper(contact),
    new WeWorkRemotelyScraper(contact),
    new RemoteOkScraper(contact),
    new HnHiringScraper(contact),
    new WwrDomScraper(contact),
  ];
}

export { BaseScraper, assertAllowedUrl } from "./base";
export { ArbeitnowScraper } from "./arbeitnow";
export { HnHiringScraper } from "./hn-hiring";
export { JobicyScraper } from "./jobicy";
export { RemoteOkScraper } from "./remoteok";
export { RemotiveScraper } from "./remotive";
export { WeWorkRemotelyScraper } from "./weworkremotely";
export { WwrDomScraper } from "./wwr-dom";
