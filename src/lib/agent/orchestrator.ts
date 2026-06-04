import {
  CRON_EMAIL_LIMIT,
  CRON_POSTING_LIMIT,
  env,
} from "@/lib/env";
import {
  draftEmailsForContacts,
  discoverContactsForTopJobs,
  sendApprovedEmails,
} from "./action";
import { memory } from "./memory";
import { runPerception } from "./perception";
import { filterPendingPostings } from "./reasoning";
import { setRunId, logEvent } from "./observability";
import { sendDailyDigest } from "@/lib/email/digest";
import type { RawPosting } from "@/types";
import type { PipelineSummary } from "@/types";

async function resolveDryRun(): Promise<boolean> {
  const dbSetting = await memory.getSetting("DRY_RUN");
  if (dbSetting !== null) return dbSetting === "true";
  return env.DRY_RUN;
}

async function resolveAgentEnabled(): Promise<boolean> {
  const dbSetting = await memory.getSetting("AGENT_ENABLED");
  if (dbSetting !== null) return dbSetting === "true";
  return env.AGENT_ENABLED;
}

export async function runScrapePipeline(): Promise<PipelineSummary> {
  return runScrapePipelineFromPostings(null);
}

export async function runScrapePipelineFromPostings(
  preloadedPostings: RawPosting[] | null
): Promise<PipelineSummary> {
  const start = Date.now();
  const run = await memory.createAgentRun("scrape");
  setRunId(run.id);

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  try {
    let perception: {
      scraped: number;
      inserted: number;
      engine?: string;
      sources?: Array<{ source: string; ok: boolean; count?: number; error?: string }>;
    };

    if (preloadedPostings) {
      const { ingestPostings } = await import("./perception");
      const { filterVaPostings } = await import("./va-filter");
      const vaOnly = filterVaPostings(preloadedPostings);
      const ingested = await ingestPostings(vaOnly);
      perception = { ...ingested, engine: "preloaded" };
    } else {
      perception = await runPerception(CRON_POSTING_LIMIT);
    }

    processed += perception.scraped;
    succeeded += perception.inserted;

    const filter = await filterPendingPostings(CRON_POSTING_LIMIT);
    processed += filter.processed;
    succeeded += filter.succeeded;

    const discovered = await discoverContactsForTopJobs(20);
    succeeded += discovered;
    processed += discovered;

    // Send the daily digest to CONTACT_EMAIL summarising VA matches.
    const dryRun = await resolveDryRun();
    const digest = await sendDailyDigest({ dryRun });

    await memory.finishAgentRun(run.id, "completed", {
      perception,
      filter,
      discovered,
      digest,
    });
  } catch (error) {
    failed++;
    const message = error instanceof Error ? error.message : String(error);
    await memory.finishAgentRun(run.id, "failed", undefined, message);
    await logEvent("error", "Scrape pipeline failed", { error: message });
  } finally {
    setRunId(undefined);
  }

  return {
    runId: run.id,
    processed,
    succeeded,
    failed,
    durationMs: Date.now() - start,
  };
}

export async function runOutreachPipeline(): Promise<PipelineSummary> {
  const start = Date.now();
  const run = await memory.createAgentRun("outreach");
  setRunId(run.id);

  const dryRun = await resolveDryRun();
  const agentEnabled = await resolveAgentEnabled();

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  try {
    const drafted = await draftEmailsForContacts(CRON_EMAIL_LIMIT, dryRun);
    processed += drafted;
    succeeded += drafted;

    const send = await sendApprovedEmails(
      CRON_EMAIL_LIMIT,
      dryRun,
      agentEnabled
    );
    processed += send.sent + send.failed;
    succeeded += send.sent;
    failed += send.failed;

    await memory.finishAgentRun(run.id, "completed", {
      drafted,
      send,
      dryRun,
    });
  } catch (error) {
    failed++;
    const message = error instanceof Error ? error.message : String(error);
    await memory.finishAgentRun(run.id, "failed", undefined, message);
    await logEvent("error", "Outreach pipeline failed", { error: message });
  } finally {
    setRunId(undefined);
  }

  return {
    runId: run.id,
    processed,
    succeeded,
    failed,
    durationMs: Date.now() - start,
  };
}
