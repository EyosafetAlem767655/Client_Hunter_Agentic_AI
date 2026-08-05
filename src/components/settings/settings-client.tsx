"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  Loader2,
  Mail,
  Play,
  Search,
  Send,
  Sparkles,
  Square,
  Trash2,
  Wand2,
  XCircle,
} from "lucide-react";
import { ENABLED_SOURCES, jobSourceLabel } from "@/lib/job-sources";
import {
  JOB_POSITIONS,
  SCRAPE_COUNTRIES,
  indeedQueryFromUrl,
  type JobPosition,
  type ScrapeCountry,
} from "@/lib/scrapers/positions";

const TOKEN_KEY = "talentbridge_admin_token";

interface SourceResult {
  source: string;
  label: string;
  ok: boolean;
  count: number;
  durationMs?: number;
  error?: string;
}

interface ScrapeProgress {
  phase: "idle" | "scraping" | "filtering" | "done";
  currentSource: string | null;
  currentLabel: string | null;
  completed: SourceResult[];
  remaining: string[];
}

interface RunResult {
  label: string;
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
  at: number;
}

export function SettingsClient({
  initial,
  maskedEnv,
}: {
  initial: { DRY_RUN: boolean; AGENT_ENABLED: boolean };
  maskedEnv: Record<string, string | boolean>;
}) {
  const [settings, setSettings] = useState(initial);
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(
    null
  );
  const [loading, setLoading] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<RunResult | null>(null);
  const [scrapeProgress, setScrapeProgress] = useState<ScrapeProgress>({
    phase: "idle",
    currentSource: null,
    currentLabel: null,
    completed: [],
    remaining: [],
  });

  // 1-by-1 contact-discovery loop state.
  const [discoveryProgress, setDiscoveryProgress] = useState<{
    totalRelevant: number;
    withContacts: number;
    attempted: number;
    skipped: number;
    pending: number;
    nextCompany: string | null;
  } | null>(null);
  const [discoveryActive, setDiscoveryActive] = useState(false);
  const [discoveryLog, setDiscoveryLog] = useState<
    Array<{
      company: string;
      email: string | null;
      contactUrl?: string | null;
      method: string | null;
    }>
  >([]);
  // Use a ref so the loop can be cancelled mid-flight.
  const stopDiscoveryRef = useState<{ current: boolean }>({ current: false })[0];
  // Seconds remaining on the post-scrape "settle" countdown before the
  // 1-by-1 email loop auto-starts. null = no countdown active.
  const [scrapeCountdown, setScrapeCountdown] = useState<number | null>(null);
  const cancelCountdownRef = useState<{ current: boolean }>({ current: false })[0];

  // Per-site individual scrape state (keyed by JobSource)
  const [siteScrapeState, setSiteScrapeState] = useState<
    Record<
      string,
      {
        loading: boolean;
        ok?: boolean;
        count?: number;
        inserted?: number;
        durationMs?: number;
        error?: string;
      }
    >
  >({});

  // Restore token + scrape results from sessionStorage on mount
  useEffect(() => {
    const saved = sessionStorage.getItem(TOKEN_KEY);
    if (saved) setToken(saved);
    try {
      const savedState = sessionStorage.getItem("site_scrape_state");
      if (savedState) {
        const parsed = JSON.parse(savedState) as Record<string, { loading: boolean; ok?: boolean; count?: number; inserted?: number; durationMs?: number; error?: string }>;
        // Clear any in-flight loading flags — they won't resolve after navigation
        for (const key of Object.keys(parsed)) {
          parsed[key].loading = false;
        }
        setSiteScrapeState(parsed);
      }
    } catch {
      // ignore corrupt storage
    }
  }, []);

  // Persist scrape state so results survive tab navigation
  useEffect(() => {
    try {
      sessionStorage.setItem("site_scrape_state", JSON.stringify(siteScrapeState));
    } catch {
      // ignore storage errors
    }
  }, [siteScrapeState]);

  // Pull initial discovery progress so the bar shows even before kickoff.
  useEffect(() => {
    if (!token.trim()) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/manual/discover/status", {
          headers: { Authorization: `Bearer ${token.trim()}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (data?.ok) {
          setDiscoveryProgress({
            totalRelevant: data.totalRelevant ?? 0,
            withContacts: data.withContacts ?? 0,
            attempted: data.attempted ?? 0,
            skipped: data.skipped ?? 0,
            pending: data.pending ?? 0,
            nextCompany: data.nextCompany ?? null,
          });
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  function saveToken(value: string) {
    setToken(value);
    if (value) sessionStorage.setItem(TOKEN_KEY, value);
    else sessionStorage.removeItem(TOKEN_KEY);
  }

  function showToast(kind: "ok" | "err", msg: string) {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 4000);
  }

  async function patchSettings(patch: Partial<typeof settings>) {
    if (!token.trim()) {
      showToast("err", "Enter your ADMIN_TOKEN first (from Vercel env vars).");
      return;
    }
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token.trim()}`,
      },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      showToast(
        "err",
        "Failed to update — check ADMIN_TOKEN matches Vercel exactly."
      );
      return;
    }
    setSettings((s) => ({ ...s, ...patch }));
    showToast("ok", "Setting updated");
  }

  async function runOne(
    path: string,
    label: string
  ): Promise<{ ok: boolean; data: Record<string, unknown>; error?: string }> {
    const res = await fetch(path, {
      method: "POST",
      headers: { Authorization: `Bearer ${token.trim()}` },
    });
    let data: Record<string, unknown> = {};
    try {
      data = await res.json();
    } catch {
      // ignore parse error
    }
    if (!res.ok || data?.ok === false) {
      return {
        ok: false,
        data,
        error: (data?.error as string) ?? `${label} ${res.status}`,
      };
    }
    return { ok: true, data };
  }

  async function runFilterLoop(source?: string): Promise<{
    processed: number;
    succeeded: number;
    relevant: number;
    steps: number;
  }> {
    let processed = 0;
    let succeeded = 0;
    let relevant = 0;
    let steps = 0;

    // Scope the filter to the source just scraped so "analyzed" matches what was
    // scraped, instead of draining the whole cross-source backlog.
    const filterPath = source
      ? `/api/manual/filter/next?n=12&source=${encodeURIComponent(source)}`
      : "/api/manual/filter/next?n=12";

    setLoading("Filter");
    for (let i = 0; i < 30; i++) {
      const result = await runOne(filterPath, "Filter");
      if (!result.ok) {
        throw new Error(result.error ?? "Filter failed");
      }

      const step = result.data.step as
        | {
            processed?: number;
            succeeded?: number;
            newMatches?: unknown[];
          }
        | undefined;
      const stepProcessed = step?.processed ?? 0;
      const stepSucceeded = step?.succeeded ?? 0;
      const stepRelevant = Array.isArray(step?.newMatches)
        ? step.newMatches.length
        : 0;

      if (stepProcessed === 0 || result.data.done === true) break;

      processed += stepProcessed;
      succeeded += stepSucceeded;
      relevant += stepRelevant;
      steps++;

      showToast(
        "ok",
        `Filter progress: ${processed} checked, ${relevant} relevant`
      );
    }

    return { processed, succeeded, relevant, steps };
  }

  async function runScrapeSequential() {
    if (!token.trim()) {
      showToast("err", "Unauthorized — enter ADMIN_TOKEN first.");
      return;
    }
    const sources = ENABLED_SOURCES;
    setScrapeProgress({
      phase: "scraping",
      currentSource: null,
      currentLabel: null,
      completed: [],
      remaining: [...sources],
    });
    setLoading("Scrape");

    const completed: SourceResult[] = [];

    for (const source of sources) {
      const label = jobSourceLabel(source);
      setScrapeProgress((prev) => ({
        ...prev,
        currentSource: source,
        currentLabel: label,
        remaining: prev.remaining.filter((s) => s !== source),
      }));

      try {
        const res = await fetch("/api/manual/scrape/source", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token.trim()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ source }),
        });
        const data: {
          ok?: boolean;
          count?: number;
          durationMs?: number;
          error?: string;
        } = await res.json().catch(() => ({}));

        const result: SourceResult = {
          source,
          label,
          ok: data.ok ?? false,
          count: data.count ?? 0,
          durationMs: data.durationMs,
          error: data.error,
        };
        completed.push(result);
        setScrapeProgress((prev) => ({
          ...prev,
          completed: [...prev.completed, result],
        }));
      } catch (e) {
        const result: SourceResult = {
          source,
          label,
          ok: false,
          count: 0,
          error: e instanceof Error ? e.message : "Request failed",
        };
        completed.push(result);
        setScrapeProgress((prev) => ({
          ...prev,
          completed: [...prev.completed, result],
        }));
      }
    }

    // All sites scraped — run LLM relevance filter
    setScrapeProgress((prev) => ({
      ...prev,
      phase: "filtering",
      currentSource: null,
      currentLabel: null,
    }));
    setLoading("Filter");

    let filter = { processed: 0, relevant: 0 };
    try {
      filter = await runFilterLoop();
    } catch (e) {
      showToast("err", `Filter failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    }

    // Refresh discovery progress bar
    try {
      const res = await fetch("/api/manual/discover/status", {
        headers: { Authorization: `Bearer ${token.trim()}` },
      });
      if (res.ok) {
        const p = await res.json();
        if (p?.ok) {
          setDiscoveryProgress({
            totalRelevant: p.totalRelevant ?? 0,
            withContacts: p.withContacts ?? 0,
            attempted: p.attempted ?? 0,
            skipped: p.skipped ?? 0,
            pending: p.pending ?? 0,
            nextCompany: p.nextCompany ?? null,
          });
        }
      }
    } catch {
      /* swallow */
    }

    setScrapeProgress((prev) => ({ ...prev, phase: "done" }));
    setLoading(null);

    const succeeded = completed.filter((r) => r.ok).length;
    const totalCount = completed.reduce((s, r) => s + r.count, 0);
    showToast(
      "ok",
      `Scrape done — ${succeeded}/${completed.length} sites · ${totalCount} postings · ${filter.relevant} relevant — auto-discovery in 60 s`
    );
    setLastRun({
      label: "Scrape + filter",
      ok: true,
      data: { sources: completed, filter },
      at: Date.now(),
    });
    void scheduleEmailLoopAfterScrape();
  }

  async function scrapeOneSite(source: string) {
    if (!token.trim()) {
      showToast("err", "Unauthorized — enter ADMIN_TOKEN first.");
      return;
    }

    const label = jobSourceLabel(source);
    setSiteScrapeState((prev) => ({ ...prev, [source]: { loading: true } }));
    try {
      const res = await fetch("/api/manual/scrape/source", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ source }),
      });
      const data: {
        ok?: boolean;
        count?: number;
        inserted?: number;
        durationMs?: number;
        error?: string;
      } = await res.json().catch(() => ({}));
      const ok = data.ok ?? false;
      setSiteScrapeState((prev) => ({
        ...prev,
        [source]: {
          loading: false,
          ok,
          count: data.count ?? 0,
          inserted: data.inserted ?? 0,
          durationMs: data.durationMs,
          error: data.error,
        },
      }));
      if (ok) {
        showToast(
          "ok",
          `${label}: ${data.count ?? 0} found, ${data.inserted ?? 0} new — filtering…`
        );
      } else {
        showToast("err", `${label} failed: ${data.error ?? "Unknown error"}`);
      }
      // Always run the filter — picks up pending jobs from this scrape AND any
      // previous scrapes that haven't been filtered yet.
      setLoading("Filter");
      try {
        const filter = await runFilterLoop(source);
        showToast("ok", `Filter done — ${filter.relevant} new relevant jobs`);
      } catch (e) {
        showToast(
          "err",
          `Filter failed: ${e instanceof Error ? e.message : "Unknown error"}`
        );
      } finally {
        setLoading(null);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Request failed";
      setSiteScrapeState((prev) => ({
        ...prev,
        [source]: { loading: false, ok: false, error: msg },
      }));
      showToast("err", `${label} failed: ${msg}`);
    }
  }

  // Scrape a SINGLE position from one source in one country, then filter it.
  //
  // LinkedIn scrapes the country's `location` (USA/UK/Canada). Indeed is USA-only:
  // the server drives its own Chromium window and rides out Cloudflare's ~15 s
  // check there (~20 s cold, ~10 s warm) — nothing opens in this browser.
  async function scrapeOnePosition(
    source: "linkedin" | "indeed",
    position: JobPosition,
    country: ScrapeCountry
  ) {
    if (!token.trim()) {
      showToast("err", "Unauthorized — enter ADMIN_TOKEN first.");
      return;
    }
    const key = `${country.id}:${source}:${position.id}`;
    const query =
      source === "indeed" ? indeedQueryFromUrl(position.indeedUrl) : position.linkedinQuery;

    setSiteScrapeState((prev) => ({ ...prev, [key]: { loading: true } }));
    try {
      const res = await fetch("/api/manual/scrape/source", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ source, query, country: country.id }),
      });
      const data: {
        ok?: boolean;
        count?: number;
        inserted?: number;
        durationMs?: number;
        error?: string;
      } = await res.json().catch(() => ({}));
      const ok = data.ok ?? false;
      setSiteScrapeState((prev) => ({
        ...prev,
        [key]: {
          loading: false,
          ok,
          count: data.count ?? 0,
          inserted: data.inserted ?? 0,
          durationMs: data.durationMs,
          error: data.error,
        },
      }));
      if (ok) {
        showToast("ok", `${country.label} · ${position.label}: ${data.count ?? 0} found, ${data.inserted ?? 0} new — filtering…`);
      } else {
        showToast("err", `${country.label} · ${position.label} failed: ${data.error ?? "Unknown error"}`);
      }
      // Relevancy filter (source-scoped) — scores + saves this position's new jobs.
      setLoading("Filter");
      try {
        const filter = await runFilterLoop(source);
        showToast("ok", `${country.label} · ${position.label}: filter done — ${filter.relevant} new relevant`);
      } catch (e) {
        showToast("err", `Filter failed: ${e instanceof Error ? e.message : "Unknown error"}`);
      } finally {
        setLoading(null);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Request failed";
      setSiteScrapeState((prev) => ({ ...prev, [key]: { loading: false, ok: false, error: msg } }));
      showToast("err", `${country.label} · ${position.label} failed: ${msg}`);
    }
  }

  async function runManual(
    path: string,
    label: string,
    opts: {
      confirm?: string;
      chain?: { path: string; label: string };
      after?: (data: Record<string, unknown>) => void | Promise<void>;
    } = {}
  ) {
    if (!token.trim()) {
      showToast(
        "err",
        "Unauthorized — enter ADMIN_TOKEN from Vercel → Settings → Environment Variables."
      );
      return;
    }
    if (opts.confirm && !window.confirm(opts.confirm)) {
      return;
    }
    setLoading(label);
    try {
      // Step 1: the user-requested action.
      const first = await runOne(path, label);
      if (!first.ok) {
        setLastRun({ label, ok: false, error: first.error, at: Date.now() });
        showToast("err", `${label} failed: ${first.error}`);
        return;
      }

      if (!opts.chain) {
        setLastRun({ label, ok: true, data: first.data, at: Date.now() });
        showToast("ok", `${label} complete`);
        if (opts.after) {
          try {
            await opts.after(first.data);
          } catch (e) {
            showToast(
              "err",
              `Post-${label} step failed: ${
                e instanceof Error ? e.message : String(e)
              }`
            );
          }
        }
        return;
      }

      // Step 2: chained follow-up (e.g. scrape -> outreach). Vercel Hobby
      // caps each function at 60 s, so the heavy contact discovery + draft +
      // send work runs as its OWN HTTP call. The UI fires it the moment
      // the scrape returns so the user gets the full end-to-end behaviour
      // without busting the timeout.
      setLoading(opts.chain.label);
      showToast("ok", `${label} done — running ${opts.chain.label}…`);
      const second = await runOne(opts.chain.path, opts.chain.label);
      if (!second.ok) {
        setLastRun({
          label: `${label} + ${opts.chain.label}`,
          ok: false,
          error: `${opts.chain.label} step failed: ${second.error}`,
          at: Date.now(),
          data: { scrape: first.data },
        });
        showToast("err", `${opts.chain.label} failed: ${second.error}`);
        return;
      }
      setLastRun({
        label: `${label} + ${opts.chain.label}`,
        ok: true,
        data: { scrape: first.data, outreach: second.data },
        at: Date.now(),
      });
      showToast("ok", `${label} + ${opts.chain.label} complete`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Request failed";
      setLastRun({ label, ok: false, error: msg, at: Date.now() });
      showToast("err", msg);
    } finally {
      setLoading(null);
    }
  }

  /**
   * Drives the 1-by-1 discovery loop. Each iteration:
   *   1. POSTs /api/manual/discover/next?n=1
   *   2. updates the progress bar + recent-finds log
   *   3. rests briefly before the next company
   * Stops when progress.pending hits 0, when the stop button is pressed,
   * or after too many consecutive failures.
   */
  async function startDiscoveryLoop() {
    if (!token.trim()) {
      showToast(
        "err",
        "Unauthorized — paste your ADMIN_TOKEN before starting discovery."
      );
      return;
    }
    if (discoveryActive) return;
    stopDiscoveryRef.current = false;
    setDiscoveryActive(true);
    setDiscoveryLog([]);

    let consecutiveErrors = 0;
    try {
      while (!stopDiscoveryRef.current) {
        let stepResult: {
          ok?: boolean;
          step?: {
            attempted: number;
            found: number;
            results: Array<{
              company: string;
              email: string | null;
              contactUrl?: string | null;
              method: string | null;
            }>;
          };
          progress?: {
            totalRelevant: number;
            withContacts: number;
            attempted: number;
            skipped: number;
            pending: number;
            nextCompany: string | null;
          };
          done?: boolean;
          error?: string;
        };
        try {
          const res = await fetch("/api/manual/discover/next?n=1", {
            method: "POST",
            headers: { Authorization: `Bearer ${token.trim()}` },
          });
          stepResult = await res.json();
          if (!res.ok || stepResult.ok === false) {
            throw new Error(stepResult.error ?? `HTTP ${res.status}`);
          }
        } catch (e) {
          consecutiveErrors++;
          showToast(
            "err",
            `Discovery step failed (${consecutiveErrors}/3): ${
              e instanceof Error ? e.message : String(e)
            }`
          );
          if (consecutiveErrors >= 3) break;
          // Brief back-off, then retry.
          await new Promise((r) => setTimeout(r, 2_500));
          continue;
        }
        consecutiveErrors = 0;

        if (stepResult.progress) setDiscoveryProgress(stepResult.progress);
        if (stepResult.step?.results?.length) {
          setDiscoveryLog((prev) =>
            [...stepResult.step!.results, ...prev].slice(0, 30)
          );
        }
        if (stepResult.done || (stepResult.progress?.pending ?? 0) === 0) {
          showToast("ok", "All companies processed");
          break;
        }
        // Short rest between companies keeps each cycle inside the Vercel
        // function budget and avoids hammering external APIs.
        await new Promise((r) => setTimeout(r, 30_000));
      }
    } finally {
      setDiscoveryActive(false);
      stopDiscoveryRef.current = false;
    }
  }

  function stopDiscoveryLoop() {
    stopDiscoveryRef.current = true;
    showToast("ok", "Stopping after the current company…");
  }

  /**
   * Per spec: after a successful scrape, wait 60 s so the LLM filter
   * commits have settled, then auto-start the 1-by-1 email loop. The
   * countdown can be cancelled if the user wants to do something else.
   */
  async function scheduleEmailLoopAfterScrape() {
    cancelCountdownRef.current = false;
    for (let s = 60; s > 0; s--) {
      if (cancelCountdownRef.current) {
        setScrapeCountdown(null);
        return;
      }
      setScrapeCountdown(s);
      await new Promise((r) => setTimeout(r, 1_000));
    }
    setScrapeCountdown(null);
    if (!discoveryActive) {
      await startDiscoveryLoop();
    }
  }

  function cancelCountdown() {
    cancelCountdownRef.current = true;
    setScrapeCountdown(null);
    showToast("ok", "Auto-discovery cancelled — use the button when ready.");
  }

  return (
    <div className="space-y-6">
      {toast && (
        <div
          className={`fixed right-6 top-20 z-50 flex max-w-md items-center gap-2 rounded-lg border px-4 py-3 shadow-2xl ${
            toast.kind === "ok"
              ? "border-emerald-800 bg-emerald-700 text-white"
              : "border-red-800 bg-red-700 text-white"
          }`}
        >
          {toast.kind === "ok" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          <span className="text-sm">{toast.msg}</span>
        </div>
      )}

      {/* Auth strip */}
      <Card className="glass-card border-primary/20">
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
          <KeyRound className="h-5 w-5 shrink-0 text-primary" />
          <div className="flex-1">
            <div className="text-sm font-medium text-foreground">
              Admin token
            </div>
            <div className="text-xs text-muted-foreground">
              Paste the <code className="rounded bg-muted px-1 font-mono">ADMIN_TOKEN</code> from
              Vercel → Project → Settings → Environment Variables. Stored only in this browser tab.
            </div>
          </div>
          <div className="relative flex-1">
            <input
              type={showToken ? "text" : "password"}
              placeholder="ADMIN_TOKEN"
              className="w-full rounded-md border border-input bg-background/60 px-3 py-2 pr-10 text-sm font-mono focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
              value={token}
              onChange={(e) => saveToken(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
              aria-label={showToken ? "Hide token" : "Show token"}
            >
              {showToken ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
          <div
            className={`flex h-2 w-2 shrink-0 rounded-full ${
              token.trim() ? "bg-amber-600 shadow-[0_0_8px_rgba(180,83,9,0.55)]" : "bg-muted"
            }`}
            aria-hidden
          />
        </CardContent>
      </Card>

      {settings.DRY_RUN && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div className="text-sm">
            <div className="font-medium text-amber-200">
              DRY_RUN is on — no real emails are being delivered.
            </div>
            <p className="mt-1 text-amber-200/80">
              The pipeline reports &quot;sent&quot; in dry-run mode but Gmail is
              never called. Toggle <strong>Dry run</strong> off below to receive
              real digest and alert emails. Use <strong>Send test email</strong>{" "}
              first to confirm your Gmail credentials work.
            </p>
          </div>
        </div>
      )}

      {/* Post-scrape countdown */}
      {scrapeCountdown !== null && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-700/40 bg-amber-100/70 px-5 py-4">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-amber-800" />
            <div>
              <div className="text-sm font-medium text-amber-900">
                Auto-starting email discovery in {scrapeCountdown}s
              </div>
              <div className="text-xs text-amber-800/80">
                Lets the LLM filter commits settle before LangSearch/OpenAI
                contact discovery starts, one company at a time.
              </div>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={cancelCountdown}
            className="border-amber-700/40 text-amber-900 hover:bg-amber-100"
          >
            Cancel
          </Button>
        </div>
      )}

      {/* Contact discovery 1-by-1 */}
      <Card className="glass-card border-primary/20">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-2">
          <div className="flex items-center gap-2">
            <Search className="h-5 w-5 text-primary" />
            <CardTitle>Email discovery</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {discoveryActive ? (
              <Button
                size="sm"
                variant="outline"
                onClick={stopDiscoveryLoop}
                className="border-red-500/50 text-red-200 hover:bg-red-500/10"
              >
                <Square className="h-4 w-4" />
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={startDiscoveryLoop}
                disabled={
                  !token.trim() ||
                  (discoveryProgress?.pending ?? 0) === 0 ||
                  loading !== null
                }
              >
                <Search className="h-4 w-4" />
                Find emails one-by-one
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Walks through every relevant job that still needs a contact and
            uses LangSearch to retrieve likely contact URLs, then OpenAI
            filters URLs and extracts emails from scraped contact pages
            one company at a time, with a{" "}
            <strong>30-second rest</strong> between calls. Each request
            finishes well under 60 s so it never trips the Vercel Hobby
            timeout. <strong>Runs automatically 60 s after a scrape;</strong>{" "}
            you can also kick it off here whenever you want.
          </p>
          {(() => {
            const total = discoveryProgress?.totalRelevant ?? 0;
            const found = discoveryProgress?.withContacts ?? 0;
            const attempted = discoveryProgress?.attempted ?? 0;
            const skipped = discoveryProgress?.skipped ?? 0;
            const pending = discoveryProgress?.pending ?? 0;
            // The bar tracks "attempted" so it advances when companies only
            // produce a review URL instead of an email.
            const pct = total > 0 ? Math.min(100, Math.round((attempted / total) * 100)) : 0;
            return (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {found.toLocaleString()} with contact ·{" "}
                    {skipped.toLocaleString()} no company URL · {pending.toLocaleString()} pending
                    {" · "}of {total.toLocaleString()} relevant
                  </span>
                  <span className="font-mono">{pct}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-background/60 ring-1 ring-border/40">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r from-amber-700 to-orange-500 transition-[width] duration-500 ${
                      discoveryActive
                        ? "shadow-[0_0_12px_rgba(180,83,9,0.55)]"
                        : ""
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {discoveryActive && discoveryProgress?.nextCompany && (
                  <div className="text-xs text-foreground/70">
                    Looking up{" "}
                    <span className="font-medium text-foreground">
                      {discoveryProgress.nextCompany}
                    </span>
                    …
                  </div>
                )}
              </div>
            );
          })()}
          {discoveryLog.length > 0 && (
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border/30 bg-background/40 p-3 text-xs">
              <div className="mb-1 flex items-center justify-between text-muted-foreground">
                <span>Recent finds:</span>
                <a
                  href="/jobs?status=with-contact&window=all"
                  className="text-amber-800 hover:text-amber-900 underline-offset-2 hover:underline"
                >
                  View all contacts →
                </a>
              </div>
              {discoveryLog.map((row, i) => (
                <div
                  key={`${row.company}-${i}`}
                  className="flex items-center justify-between gap-3"
                >
                  <a
                    href={`/jobs?status=with-contact&window=all`}
                    className="truncate transition hover:text-amber-900"
                    title={`Open ${row.company} in the jobs list`}
                  >
                    <span className="font-medium">{row.company}</span>
                    {row.method && (
                      <span className="ml-2 rounded bg-amber-700/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-900">
                        {row.method}
                      </span>
                    )}
                  </a>
                  <span
                    title={row.email ?? row.contactUrl ?? "no match"}
                    className={
                      row.email
                        ? "max-w-[18rem] truncate rounded bg-amber-200 px-2 py-0.5 text-amber-900"
                        : "max-w-[18rem] truncate text-muted-foreground"
                    }
                  >
                    {row.email ?? row.contactUrl ?? "no match"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Manual actions */}
        <Card className="glass-card lg:col-span-2">
          <CardHeader className="flex flex-row items-center gap-2 space-y-0">
            <Wand2 className="h-5 w-5 text-primary" />
            <CardTitle>Manual triggers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Per-position scrape tables — grouped by country, one table per
                source, scraped one role at a time. USA = Indeed + LinkedIn;
                UK & Canada = LinkedIn only. */}
            {SCRAPE_COUNTRIES.map((country) => (
              <div key={country.id} className="rounded-xl border border-primary/25 bg-background/20 p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{country.label} — Remote</span>
                  <span className="text-xs text-muted-foreground">
                    {country.sources.map(jobSourceLabel).join(" + ")}
                  </span>
                </div>

                {country.sources.map((source) => (
                  <div key={source} className="rounded-lg border border-primary/15 bg-background/40 p-3 space-y-3">
                    <div className="flex items-center gap-2">
                      <Search className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">{jobSourceLabel(source)}</span>
                      {source === "indeed" && (
                        <span className="text-xs text-amber-700/80">
                          opens a browser window · solve the &quot;I&apos;m not a robot&quot; check if it appears · local only
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {JOB_POSITIONS.map((position) => {
                        const key = `${country.id}:${source}:${position.id}`;
                        const state = siteScrapeState[key];
                        const busy = state?.loading ?? false;
                        return (
                          <button
                            key={key}
                            disabled={!token.trim() || busy || loading !== null}
                            onClick={() => void scrapeOnePosition(source, position, country)}
                            className="flex flex-col items-start gap-1 rounded-lg border border-primary/20 bg-background/50 p-2.5 text-left hover:bg-primary/5 disabled:opacity-40 transition-colors"
                          >
                            <div className="flex items-center gap-1.5 text-sm font-medium">
                              {busy ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
                              ) : state?.ok === true ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                              ) : state?.ok === false ? (
                                <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                              ) : (
                                <Play className="h-3.5 w-3.5 text-primary shrink-0" />
                              )}
                              <span className="truncate">{position.label}</span>
                            </div>
                            {state && !busy && (
                              <span className="text-xs text-muted-foreground truncate w-full">
                                {state.ok
                                  ? `${state.count ?? 0} found · ${state.inserted ?? 0} new${state.durationMs ? ` · ${(state.durationMs / 1000).toFixed(1)}s` : ""}`
                                  : (state.error ?? "Failed").slice(0, 42)}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ))}

            {/* Pipeline controls */}
            <div className="grid gap-3 sm:grid-cols-2">
              <ActionTile
                title="Run outreach now"
                description="Draft and send pending outreach emails through the guardrails layer. Respects DRY_RUN."
                disabled={loading !== null}
                loading={loading === "Outreach"}
                onClick={() => runManual("/api/manual/outreach", "Outreach")}
                icon={<Mail className="h-5 w-5" />}
                gradient="from-yellow-200/60 to-amber-100/50"
              />
              <ActionTile
                title="Send test email"
                description="Send a one-off test email to CONTACT_EMAIL via Gmail. Bypasses DRY_RUN — use this to verify your Gmail app password is correct."
                disabled={loading !== null}
                loading={loading === "Test email"}
                onClick={() => runManual("/api/manual/test-email", "Test email")}
                icon={<Send className="h-5 w-5" />}
                gradient="from-orange-300/50 to-amber-200/40"
              />
              <ActionTile
                title="Send digest now"
                description="Fire the daily medical digest email immediately. Decoupled from the scrape so it doesn't cost Vercel function time during the run. Respects DRY_RUN."
                disabled={loading !== null}
                loading={loading === "Digest"}
                onClick={() => runManual("/api/manual/digest", "Digest")}
                icon={<FileText className="h-5 w-5" />}
                gradient="from-amber-500/30 to-orange-500/20"
              />
              <ActionTile
                title="Reset all data"
                description="Wipe every scraped job, filter result, contact, draft, and run log. Keeps settings, cron schedule, and the suppression list. This cannot be undone."
                disabled={loading !== null}
                loading={loading === "Reset"}
                onClick={() =>
                  runManual("/api/manual/reset?confirm=yes", "Reset", {
                    confirm:
                      "This will delete every scraped job, filter result, contact, draft, and run log. Settings and cron schedule are preserved. Continue?",
                    after: () => {
                      window.location.reload();
                    },
                  })
                }
                icon={<Trash2 className="h-5 w-5" />}
                gradient="from-red-500/30 to-rose-500/20"
                destructive
              />
            </div>

            {/* Live per-site scraping progress */}
            {scrapeProgress.phase !== "idle" && (
              <div className="rounded-xl border border-amber-700/30 bg-amber-50/30 p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {scrapeProgress.phase === "filtering" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-amber-700" />
                      <span>Running relevance filter…</span>
                    </>
                  ) : scrapeProgress.phase === "done" ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <span>All sites scraped</span>
                    </>
                  ) : (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-amber-700" />
                      <span>
                        Scraping:{" "}
                        <strong className="text-amber-900">
                          {scrapeProgress.currentLabel}
                        </strong>
                      </span>
                    </>
                  )}
                </div>

                <div className="space-y-1.5">
                  {scrapeProgress.completed.map((r) => (
                    <div key={r.source} className="flex items-center gap-2 text-xs">
                      {r.ok ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                      )}
                      <span className="w-40 font-medium shrink-0">{r.label}</span>
                      {r.ok ? (
                        <span className="text-muted-foreground">
                          {r.count} postings
                          {r.durationMs
                            ? ` · ${(r.durationMs / 1000).toFixed(1)}s`
                            : ""}
                        </span>
                      ) : (
                        <span className="text-red-400 truncate">{r.error}</span>
                      )}
                    </div>
                  ))}

                  {scrapeProgress.phase === "scraping" &&
                    scrapeProgress.currentSource && (
                      <div className="flex items-center gap-2 text-xs">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-700 shrink-0" />
                        <span className="w-40 font-medium shrink-0 text-amber-900">
                          {scrapeProgress.currentLabel}
                        </span>
                        <span className="text-muted-foreground">scraping…</span>
                      </div>
                    )}

                  {scrapeProgress.remaining.map((source) => (
                    <div
                      key={source}
                      className="flex items-center gap-2 text-xs opacity-40"
                    >
                      <CircleDashed className="h-3.5 w-3.5 shrink-0" />
                      <span className="w-40 font-medium shrink-0">
                        {jobSourceLabel(source)}
                      </span>
                      <span className="text-muted-foreground">pending</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {lastRun && (
              <div
                className={`rounded-lg border p-4 ${
                  lastRun.ok
                    ? "border-amber-700/30 bg-amber-100/40"
                    : "border-red-500/30 bg-red-500/5"
                }`}
              >
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  {lastRun.ok ? (
                    <CheckCircle2 className="h-4 w-4 text-amber-700" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-red-400" />
                  )}
                  <span>
                    {lastRun.label} {lastRun.ok ? "succeeded" : "failed"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(lastRun.at).toLocaleTimeString()}
                  </span>
                </div>
                {lastRun.error && (
                  <p className="text-sm text-red-300">{lastRun.error}</p>
                )}
                {lastRun.data && (
                  <pre className="mt-2 max-h-60 overflow-auto rounded bg-background/60 p-3 text-xs font-mono text-muted-foreground">
                    {JSON.stringify(lastRun.data, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Toggles */}
        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center gap-2 space-y-0">
            <Sparkles className="h-5 w-5 text-primary" />
            <CardTitle>Agent toggles</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <ToggleRow
              label="Dry run"
              hint="Drafts and queues emails without actually delivering them."
              checked={settings.DRY_RUN}
              onChange={(v) => patchSettings({ DRY_RUN: v })}
            />
            <ToggleRow
              label="Agent enabled"
              hint="Master switch — when off, no outreach sends."
              checked={settings.AGENT_ENABLED}
              onChange={(v) => patchSettings({ AGENT_ENABLED: v })}
            />
          </CardContent>
        </Card>

        {/* Env table */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Environment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 font-mono text-xs">
            {Object.entries(maskedEnv).map(([k, v]) => (
              <div
                key={k}
                className="flex items-center justify-between gap-4 rounded-md border border-border/30 bg-background/30 px-3 py-2"
              >
                <span className="text-muted-foreground">{k}</span>
                <span className="truncate text-right text-foreground/90">
                  {String(v)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border/30 bg-background/30 p-3">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function ActionTile({
  title,
  description,
  onClick,
  disabled,
  loading,
  icon,
  gradient,
  primary,
  destructive,
}: {
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon: React.ReactNode;
  gradient: string;
  primary?: boolean;
  destructive?: boolean;
}) {
  return (
    <div
      className={`group relative overflow-hidden rounded-xl border ${
        destructive ? "border-red-500/30 hover:border-red-400/60" : "border-border/40 hover:border-primary/60"
      } bg-gradient-to-br ${gradient} p-5 transition`}
    >
      <div className="mb-3 flex items-center gap-2 text-foreground">
        <div
          className={`rounded-md bg-background/60 p-2 ring-1 ${
            destructive ? "ring-red-500/50 text-red-300" : "ring-border/50"
          }`}
        >
          {icon}
        </div>
        <h4 className="font-semibold">{title}</h4>
      </div>
      <p className="mb-4 text-xs text-foreground/80">{description}</p>
      <Button
        onClick={onClick}
        disabled={disabled}
        variant={primary ? "default" : "outline"}
        size="sm"
        className={`w-full ${destructive ? "border-red-500/50 text-red-200 hover:bg-red-500/10" : ""}`}
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Running…
          </>
        ) : destructive ? (
          <>Wipe data</>
        ) : (
          <>Run now</>
        )}
      </Button>
    </div>
  );
}
