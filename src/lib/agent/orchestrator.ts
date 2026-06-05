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
import { sendDailyDigest, sendInstantVaAlert } from "@/lib/email/digest";
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

export interface ScrapePipelineOptions {
  /**
   * Send the full daily digest email at the end of the run. We default
   * this OFF for manual triggers (the user can fire it from Settings)
   * because piling it on top of perception + filter + instant alert
   * pushes the wall-time over Vercel Hobby's 60 s function ceiling.
   * The 06:00 UTC cron passes `true` so the daily summary still goes
   * out automatically once a day.
   */
  sendDigest?: boolean;
}

export async function runScrapePipeline(
  options: ScrapePipelineOptions = {}
): Promise<PipelineSummary> {
  return runScrapePipelineFromPostings(null, options);
}

export async function runScrapePipelineFromPostings(
  preloadedPostings: RawPosting[] | null,
  options: ScrapePipelineOptions = {}
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

    // Time-aware budget. Vercel Hobby caps each function at 60 s, so we
    // hard-stop the pipeline at ~55 s of wall-time to give the response
    // a chance to come back. Per-phase guards skip work that almost
    // certainly won't finish, instead of running into the ceiling and
    // returning HTTP 504 with nothing persisted.
    const deadlineMs = start + 55_000;
    const timeLeft = () => deadlineMs - Date.now();

    const filter = await filterPendingPostings(CRON_POSTING_LIMIT);
    processed += filter.processed;
    succeeded += filter.succeeded;

    const dryRun = await resolveDryRun();

    // Instant alert: fire one email per scrape run that surfaces a VA or
    // VA-similar match the LLM just classified. Cheap — single SMTP send.
    let alert: Awaited<ReturnType<typeof sendInstantVaAlert>> = {
      sent: false,
      count: 0,
      dryRun,
    };
    if (timeLeft() > 6_000) {
      alert = await sendInstantVaAlert(filter.newMatches, { dryRun });
    } else {
      await logEvent("warn", "Skipping instant alert — budget tight", {
        timeLeftMs: timeLeft(),
      });
    }

    // Daily digest is the bigger SMTP payload — multiple DB joins, HTML
    // render, sendMail. Only fire it when explicitly asked (cron) and
    // there's time. Manual scrapes leave it for the dedicated
    // /api/manual/digest endpoint so they always come back under budget.
    let digest: Awaited<ReturnType<typeof sendDailyDigest>> = {
      sent: false,
      count: 0,
      dryRun,
    };
    if (options.sendDigest && timeLeft() > 8_000) {
      digest = await sendDailyDigest({ dryRun });
    } else if (options.sendDigest) {
      await logEvent("warn", "Skipping digest — budget tight", {
        timeLeftMs: timeLeft(),
      });
    }

    // NB: Grok contact discovery + draft + send used to run here too, but
    // 80+ scraped postings push the combined pipeline past the Vercel
    // Hobby 60 s function ceiling (HTTP 504). Discovery is the slow step
    // (Grok chains 3-5 searches per company), so it now lives in
    // runOutreachPipeline instead. The manual scrape UI chains a call to
    // /api/manual/outreach immediately after, and the 14:00 UTC outreach
    // cron picks anything up that's still pending.

    if (runId !== -1) {
      try {
        await memory.finishAgentRun(runId, "completed", {
          perception,
          filter: {
            processed: filter.processed,
            succeeded: filter.succeeded,
            newMatchCount: filter.newMatches.length,
          },
          alert,
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
    // Time-aware budget: Vercel Hobby caps this function at 60 s. Each step
    // bails out early if the remaining wall-time is too small for it to
    // realistically finish — better to ship partial results than 504.
    const deadlineMs = start + 55_000;
    const timeLeft = () => deadlineMs - Date.now();

    // Phase 1: Grok / DDG / on-site contact discovery for top jobs that
    // are still missing a contact. Each Grok batch is ~15-20 s, so we cap
    // the per-call job count by remaining time.
    let discovered = 0;
    if (timeLeft() > 25_000) {
      const slot = Math.min(15, Math.floor(timeLeft() / 3_000));
      discovered = await discoverContactsForTopJobs(slot);
      processed += discovered;
      succeeded += discovered;
    } else {
      await logEvent("warn", "Outreach: skipping discovery — budget tight", {
        timeLeftMs: timeLeft(),
      });
    }

    // Phase 2: draft personalized emails for the contacts we now have.
    let drafted = 0;
    if (timeLeft() > 12_000) {
      const slot = Math.min(CRON_EMAIL_LIMIT, Math.floor(timeLeft() / 2_500));
      drafted = await draftEmailsForContacts(slot, dryRun);
      processed += drafted;
      succeeded += drafted;
    } else {
      await logEvent("warn", "Outreach: skipping draft — budget tight", {
        timeLeftMs: timeLeft(),
      });
    }

    // Phase 3: actually deliver via SMTP.
    let send = { sent: 0, failed: 0 };
    if (timeLeft() > 4_000) {
      const slot = Math.min(CRON_EMAIL_LIMIT, Math.floor(timeLeft() / 1_500));
      send = await sendApprovedEmails(slot, dryRun, agentEnabled);
      processed += send.sent + send.failed;
      succeeded += send.sent;
      failed += send.failed;
    } else {
      await logEvent("warn", "Outreach: skipping send — budget tight", {
        timeLeftMs: timeLeft(),
      });
    }

    if (runId !== -1) {
      try {
        await memory.finishAgentRun(runId, "completed", {
          discovered,
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
