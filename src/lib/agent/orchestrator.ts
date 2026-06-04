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
  let runId = -1;
  try {
    const run = await memory.createAgentRun("scrape");
    runId = run.id;
    setRunId(runId);
  } catch (e) {
    // DB may be unreachable on cold start. Continue with runId=-1 so the
    // pipeline can still report what it tried, instead of returning 500.
    const message = e instanceof Error ? e.message : String(e);
    console.error("createAgentRun failed", message);
  }

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

    if (runId !== -1) {
      try {
        await memory.finishAgentRun(runId, "completed", {
          perception,
          filter,
          discovered,
          digest,
        });
      } catch (e) {
        console.error("finishAgentRun failed", e);
      }
    }
  } catch (error) {
    failed++;
    const message = error instanceof Error ? error.message : String(error);
    if (runId !== -1) {
      try {
        await memory.finishAgentRun(runId, "failed", undefined, message);
      } catch (e) {
        console.error("finishAgentRun (failed) failed", e);
      }
    }
    try {
      await logEvent("error", "Scrape pipeline failed", { error: message });
    } catch {
      // last resort — DB log failed, console is the only sink left
      console.error("Scrape pipeline failed:", message);
    }
  } finally {
    setRunId(undefined);
  }

  return {
    runId,
    processed,
    succeeded,
    failed,
    durationMs: Date.now() - start,
  };
}

export async function runOutreachPipeline(): Promise<PipelineSummary> {
  const start = Date.now();
  let runId = -1;
  try {
    const run = await memory.createAgentRun("outreach");
    runId = run.id;
    setRunId(runId);
  } catch (e) {
    console.error("createAgentRun (outreach) failed", e);
  }

  const dryRun = await resolveDryRun().catch(() => true);
  const agentEnabled = await resolveAgentEnabled().catch(() => false);

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

    if (runId !== -1) {
      try {
        await memory.finishAgentRun(runId, "completed", {
          drafted,
          send,
          dryRun,
        });
      } catch (e) {
        console.error("finishAgentRun (outreach) failed", e);
      }
    }
  } catch (error) {
    failed++;
    const message = error instanceof Error ? error.message : String(error);
    if (runId !== -1) {
      try {
        await memory.finishAgentRun(runId, "failed", undefined, message);
      } catch (e) {
        console.error("finishAgentRun (outreach failed) failed", e);
      }
    }
    try {
      await logEvent("error", "Outreach pipeline failed", { error: message });
    } catch {
      console.error("Outreach pipeline failed:", message);
    }
  } finally {
    setRunId(undefined);
  }

  return {
    runId,
    processed,
    succeeded,
    failed,
    durationMs: Date.now() - start,
  };
}
