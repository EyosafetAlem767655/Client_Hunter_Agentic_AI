import { env } from "@/lib/env";
import { HnHiringScraper } from "./hn-hiring";
import { RemoteOkScraper } from "./remoteok";
import { WeWorkRemotelyScraper } from "./weworkremotely";
import type { BaseScraper } from "./base";

export function getEnabledScrapers(): BaseScraper[] {
  const contact = env.CONTACT_EMAIL;
  return [
    new RemoteOkScraper(contact),
    new WeWorkRemotelyScraper(contact),
    new HnHiringScraper(contact),
  ];
}

export { BaseScraper, assertAllowedUrl } from "./base";
export { RemoteOkScraper } from "./remoteok";
export { WeWorkRemotelyScraper } from "./weworkremotely";
export { HnHiringScraper } from "./hn-hiring";
