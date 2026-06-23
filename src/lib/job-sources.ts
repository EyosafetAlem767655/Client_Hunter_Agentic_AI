import type { JobSource, ScrapeSourceStatus } from "@/types";

export const JOB_SOURCE_META = {
  remoteok: { label: "RemoteOK", requested: true },
  remote_co: { label: "Remote.co", requested: true },
  weworkremotely: { label: "We Work Remotely", requested: true },
  wwr_dom: { label: "We Work Remotely HTML", requested: false },
  wellfound: { label: "Wellfound", requested: true },
  reed: { label: "Reed.co.uk", requested: true },
  totaljobs: { label: "Totaljobs", requested: true },
  stepstone: { label: "StepStone", requested: true },
  welcome_to_the_jungle: {
    label: "Welcome to the Jungle",
    requested: true,
  },
  monster: { label: "Monster", requested: true },
  indeed: { label: "Indeed", requested: true },
  ziprecruiter: { label: "ZipRecruiter", requested: true },
  remotive: { label: "Remotive", requested: false },
  arbeitnow: { label: "Arbeitnow", requested: false },
  jobicy: { label: "Jobicy", requested: false },
  hn: { label: "HN Hiring", requested: false },
} as const satisfies Record<JobSource, { label: string; requested: boolean }>;

export const REQUESTED_JOB_SOURCES = Object.entries(JOB_SOURCE_META)
  .filter(([, meta]) => meta.requested)
  .map(([source]) => source as JobSource);

export const ALL_JOB_SOURCES = Object.keys(JOB_SOURCE_META) as JobSource[];
export const HIDDEN_JOB_SOURCES = ["hn"] as const;

export function isVisibleJobSource(source: string): boolean {
  return !HIDDEN_JOB_SOURCES.includes(source as (typeof HIDDEN_JOB_SOURCES)[number]);
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
