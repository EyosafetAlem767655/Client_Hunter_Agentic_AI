import type { JobSource, ScrapeSourceStatus } from "@/types";

export const JOB_SOURCE_META = {
  remotive: { label: "Remotive", requested: false },
  jobicy: { label: "Jobicy", requested: false },
  wwr_dom: { label: "We Work Remotely", requested: false },
  linkedin: { label: "LinkedIn", requested: true },
  hn: { label: "HN Hiring", requested: false },
  // Sources below are disabled — kept in the type for historical DB rows
  wellfound: { label: "Wellfound", requested: false },
  monster: { label: "Monster", requested: false },
  indeed: { label: "Indeed", requested: true },
  remote_co: { label: "Remote.co", requested: false },
  remoteok: { label: "RemoteOK", requested: false },
  // Sources below are disabled — kept in the type for historical DB rows
  weworkremotely: { label: "We Work Remotely (RSS)", requested: false },
  reed: { label: "Reed.co.uk", requested: false },
  totaljobs: { label: "Totaljobs", requested: false },
  stepstone: { label: "StepStone", requested: false },
  welcome_to_the_jungle: { label: "Welcome to the Jungle", requested: false },
  arbeitnow: { label: "Arbeitnow", requested: false },
  ziprecruiter: { label: "ZipRecruiter", requested: false },
} as const satisfies Record<JobSource, { label: string; requested: boolean }>;

/**
 * Ordered list of active sources — used by the UI sequential scrape loop.
 * Keep in sync with scraperForSource() in src/lib/scrapers/index.ts.
 */
export const ENABLED_SOURCES: JobSource[] = [
  "linkedin",
  "indeed",
];

export const REQUESTED_JOB_SOURCES = Object.entries(JOB_SOURCE_META)
  .filter(([, meta]) => meta.requested)
  .map(([source]) => source as JobSource);

export const ALL_JOB_SOURCES = Object.keys(JOB_SOURCE_META) as JobSource[];
export const HIDDEN_JOB_SOURCES: readonly string[] = [];

export function isVisibleJobSource(source: string): boolean {
  return !HIDDEN_JOB_SOURCES.includes(source);
}

export function jobSourceLabel(source: string): string {
  return JOB_SOURCE_META[source as JobSource]?.label ?? source;
}

export function notAttemptedSourceStatus(source: JobSource): ScrapeSourceStatus {
  return {
    source,
    label: jobSourceLabel(source),
    ok: false,
    status: "not_attempted",
    count: 0,
  };
}
