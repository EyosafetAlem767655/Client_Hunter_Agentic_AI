import { env } from "@/lib/env";
import { IndeedScraper } from "./indeed";
import { JobicyScraper } from "./jobicy";
import { MonsterScraper } from "./monster";
import { RemoteCoScraper } from "./remote-co";
import { RemoteOkScraper } from "./remoteok";
import { RemotiveScraper } from "./remotive";
import { WellfoundScraper } from "./wellfound";
import { WwrDomScraper } from "./wwr-dom";
import { HnHiringScraper } from "./hn-hiring";
import type { BaseScraper } from "./base";
import type { JobSource } from "@/types";

/**
 * Ordered list of enabled sources. The UI iterates this array sequentially,
 * scraping one site at a time and showing live progress.
 */
export const ENABLED_SOURCES: JobSource[] = [
  "indeed",
  "remotive",
  "jobicy",
  "remote_co",
  "wwr_dom",
  "remoteok",
  "wellfound",
  "monster",
  "hn",
];

export function getEnabledScrapers(): BaseScraper[] {
  const contact = env.CONTACT_EMAIL;
  return [
    new IndeedScraper(contact),
    new RemotiveScraper(contact),
    new JobicyScraper(contact),
    new RemoteCoScraper(contact),
    new WwrDomScraper(contact),
    new RemoteOkScraper(contact),
    new WellfoundScraper(contact),
    new MonsterScraper(contact),
    new HnHiringScraper(contact),
  ];
}

export function scraperForSource(source: JobSource): BaseScraper | null {
  const contact = env.CONTACT_EMAIL;
  switch (source) {
    case "indeed": return new IndeedScraper(contact);
    case "remotive": return new RemotiveScraper(contact);
    case "jobicy": return new JobicyScraper(contact);
    case "remote_co": return new RemoteCoScraper(contact);
    case "wwr_dom": return new WwrDomScraper(contact);
    case "remoteok": return new RemoteOkScraper(contact);
    case "wellfound": return new WellfoundScraper(contact);
    case "monster": return new MonsterScraper(contact);
    case "hn": return new HnHiringScraper(contact);
    default: return null;
  }
}

export { BaseScraper, assertAllowedUrl } from "./base";
export { IndeedScraper } from "./indeed";
export { HnHiringScraper } from "./hn-hiring";
export { JobicyScraper } from "./jobicy";
export { MonsterScraper } from "./monster";
export { RemoteCoScraper } from "./remote-co";
export { RemoteOkScraper } from "./remoteok";
export { RemotiveScraper } from "./remotive";
export { WellfoundScraper } from "./wellfound";
export { WwrDomScraper } from "./wwr-dom";
