/**
 * Turn the local Indeed subprocess result into what the dashboard should say.
 *
 * `reason` is emitted by api/py/scrape_jobs.py (`_INDEED_STATUS`):
 *   ok | challenge_not_cleared | no_results | browser_failed | skipped
 */
export type IndeedReason =
  | "ok"
  | "challenge_not_cleared"
  | "no_results"
  | "browser_failed"
  | "skipped"
  | (string & {});

export interface IndeedOutcome {
  /** True when the run should be reported as a success (possibly with 0 jobs). */
  ok: boolean;
  /** Human-readable explanation for the UI when `ok` is false. */
  error?: string;
}

export function describeIndeedOutcome(input: {
  reason?: IndeedReason;
  timedOut?: boolean;
  timeoutMs?: number;
  stderrTail?: string;
  onVercel?: boolean;
}): IndeedOutcome {
  const { reason, timedOut, timeoutMs, stderrTail, onVercel } = input;

  if (onVercel) {
    return {
      ok: false,
      error:
        "Indeed can't be scraped from the server: clearing its Cloudflare check needs a real browser window, and there's no display on Vercel. Run the app locally to scrape Indeed.",
    };
  }

  if (timedOut) {
    const secs = Math.round((timeoutMs ?? 0) / 1000);
    return {
      ok: false,
      error: `Indeed scrape timed out after ${secs}s (browser launch + check + page load). Try again — if a Chrome window was left open, close it first.`,
    };
  }

  if (reason === "no_results") {
    // The check cleared; Indeed just had nothing new for this search.
    return { ok: true };
  }

  if (reason === "browser_failed") {
    const detail = stderrTail?.trim();
    return {
      ok: false,
      error: `Could not open a browser for Indeed.${detail ? ` ${detail}` : ""} Install Chrome/Edge or run \`python -m playwright install chromium\`.`,
    };
  }

  return {
    ok: false,
    error:
      "Indeed's Cloudflare check didn't clear. A Chrome window should have opened — if it asked you to verify, run this again and complete the check in that window within 15 seconds.",
  };
}
