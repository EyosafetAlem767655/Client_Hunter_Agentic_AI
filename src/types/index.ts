export type JobSource =
  | "remoteok"
  | "weworkremotely"
  | "hn"
  | "remotive"
  | "arbeitnow"
  | "jobicy"
  | "wwr_dom";

export interface RawPosting {
  source: JobSource;
  externalId: string;
  url: string;
  title: string;
  company: string;
  location: string;
  description: string;
  postedAt: Date | null;
  raw: Record<string, unknown>;
}

export type ContactSourceType =
  | "listed"
  | "pattern_guessed"
  | "scraped_from_site"
  | "langsearch_scraped"
  | "url_only"
  | "no_contact_url";

export interface DiscoveredContact {
  email: string | null;
  contactUrl?: string | null;
  sourceType: ContactSourceType;
  confidence: number;
}

export type OutreachStatus =
  | "pending"
  | "approved"
  | "sent"
  | "failed"
  | "bounced"
  | "replied";

export type AgentRunType = "scrape" | "outreach" | "filter" | "discover";
export type AgentRunStatus = "running" | "completed" | "failed";
export type EventLevel = "info" | "warn" | "error";

export interface GuardrailResult {
  ok: boolean;
  reason?: string;
}

export interface PipelineSummary {
  runId: number;
  processed: number;
  succeeded: number;
  failed: number;
  durationMs: number;
  /** Pipeline-specific extras (e.g. relevant count from a scrape). */
  stats?: Record<string, number>;
}
