import { env } from "@/lib/env";
import { ArbeitnowScraper } from "./arbeitnow";
import { JobicyScraper } from "./jobicy";
import { MonsterScraper } from "./monster";
import { ReedScraper } from "./reed";
import { RejectedSourceScraper } from "./rejected-source";
import { RemoteCoScraper } from "./remote-co";
import { RemoteOkScraper } from "./remoteok";
import { RemotiveScraper } from "./remotive";
import { StepStoneScraper } from "./stepstone";
import { TotaljobsScraper } from "./totaljobs";
import { WelcomeToTheJungleScraper } from "./welcome-to-the-jungle";
import { WeWorkRemotelyScraper } from "./weworkremotely";
import { WellfoundScraper } from "./wellfound";
import { WwrDomScraper } from "./wwr-dom";
import type { BaseScraper } from "./base";

/**
 * Ordered list of scrapers. We list the most cloud-IP-friendly JSON APIs
 * first (Remotive / Arbeitnow / Jobicy), then the trickier RSS / API sources
 * (WeWorkRemotely RSS, RemoteOK API), then a DOM/HTML scraper as
 * a last-resort fallback. `Promise.allSettled` in the runner means a single
 * blocked source can't take down the whole run.
 */
export function getEnabledScrapers(): BaseScraper[] {
  const contact = env.CONTACT_EMAIL;
  return [
    new RemotiveScraper(contact),
    new ArbeitnowScraper(contact),
    new JobicyScraper(contact),
    new ReedScraper(contact),
    new RemoteCoScraper(contact),
    new WeWorkRemotelyScraper(contact),
    new RemoteOkScraper(contact),
    new WellfoundScraper(contact),
    new TotaljobsScraper(contact),
    new StepStoneScraper(contact),
    new WelcomeToTheJungleScraper(contact),
    new MonsterScraper(contact),
    new WwrDomScraper(contact),
    new RejectedSourceScraper(
      "indeed",
      contact,
      "Direct scraping disabled: use an official Indeed partner/API feed before enabling this source"
    ),
    new RejectedSourceScraper(
      "ziprecruiter",
      contact,
      "Direct scraping disabled: ZipRecruiter disallows broad crawling for default bots"
    ),
  ];
}

export { BaseScraper, assertAllowedUrl } from "./base";
export { ArbeitnowScraper } from "./arbeitnow";
export { HnHiringScraper } from "./hn-hiring";
export { JobicyScraper } from "./jobicy";
export { MonsterScraper } from "./monster";
export { ReedScraper } from "./reed";
export { RemoteCoScraper } from "./remote-co";
export { RemoteOkScraper } from "./remoteok";
export { RemotiveScraper } from "./remotive";
export { StepStoneScraper } from "./stepstone";
export { TotaljobsScraper } from "./totaljobs";
export { WelcomeToTheJungleScraper } from "./welcome-to-the-jungle";
export { WeWorkRemotelyScraper } from "./weworkremotely";
export { WellfoundScraper } from "./wellfound";
export { WwrDomScraper } from "./wwr-dom";
