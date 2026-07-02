"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

const TOKEN_KEY = "talentbridge_admin_token";
const BC_CHANNEL = "lead-enriched";

interface LeadJob {
  postingId: number;
  title: string;
  company: string;
  url: string;
  score: number;
  isEnriched: boolean;
  contactEmail: string | null;
  contactUrl: string | null;
}

interface LeadStatusData {
  high: { items: LeadJob[]; total: number };
  mid: { items: LeadJob[]; total: number };
}

interface Props {
  initialAutoEnrich: boolean;
}

function broadcastEnrichChange() {
  try {
    const ch = new BroadcastChannel(BC_CHANNEL);
    ch.postMessage("changed");
    ch.close();
  } catch {
    // BroadcastChannel not available — window event covers same-page case
  }
  window.dispatchEvent(new CustomEvent("lead-enriched-changed"));
}

export function LeadStatusTab({ initialAutoEnrich }: Props) {
  const [autoEnrich, setAutoEnrich] = useState(initialAutoEnrich);
  const [data, setData] = useState<LeadStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [togglingAuto, setTogglingAuto] = useState(false);
  const [enrichingAll, setEnrichingAll] = useState(false);
  const [enrichingId, setEnrichingId] = useState<number | null>(null);
  const [actingId, setActingId] = useState<number | null>(null);
  // Optimistic overrides: true = locally marked, false = locally unmarked
  const [localOverrides, setLocalOverrides] = useState<Map<number, boolean>>(new Map());
  const [enrichResult, setEnrichResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs/lead-status", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as LeadStatusData;
      setData(json);
      setLocalOverrides(new Map()); // clear overrides once server state is fresh
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  function getToken(): string {
    return typeof window !== "undefined"
      ? (sessionStorage.getItem(TOKEN_KEY) ?? "")
      : "";
  }

  function isEffectivelyEnriched(job: LeadJob): boolean {
    const override = localOverrides.get(job.postingId);
    if (override !== undefined) return override;
    return job.isEnriched;
  }

  async function toggleAutoEnrich() {
    const token = getToken();
    if (!token) {
      setEnrichResult("Paste your ADMIN_TOKEN in Settings first.");
      return;
    }
    setTogglingAuto(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ CLAY_AUTO_ENRICH: !autoEnrich }),
      });
      if (res.ok) {
        setAutoEnrich((prev) => !prev);
        setEnrichResult(null);
      }
    } finally {
      setTogglingAuto(false);
    }
  }

  async function enrichAll() {
    const token = getToken();
    if (!token) {
      setEnrichResult("Paste your ADMIN_TOKEN in Settings first.");
      return;
    }
    setEnrichingAll(true);
    setEnrichResult(null);
    try {
      const res = await fetch("/api/admin/enrich", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as {
        ok: boolean;
        enriched?: number;
        contactsSaved?: number;
        errors?: string[];
        error?: string;
      };
      if (json.ok) {
        setEnrichResult(
          `Enriched ${json.enriched ?? 0} jobs · ${json.contactsSaved ?? 0} contacts saved${json.errors?.length ? ` · ${json.errors.length} errors` : ""}`
        );
        broadcastEnrichChange();
        await fetchData();
      } else {
        setEnrichResult(`Error: ${json.error ?? "Unknown"}`);
      }
    } catch (e) {
      setEnrichResult(`Network error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setEnrichingAll(false);
    }
  }

  async function enrichOne(postingId: number) {
    const token = getToken();
    if (!token) {
      setEnrichResult("Paste your ADMIN_TOKEN in Settings first.");
      return;
    }
    setEnrichingId(postingId);
    setEnrichResult(null);
    try {
      const res = await fetch("/api/admin/enrich", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ postingId }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        contactsSaved?: number;
        error?: string;
      };
      if (json.ok) {
        setEnrichResult(`Saved ${json.contactsSaved ?? 0} contact(s)`);
        broadcastEnrichChange();
        await fetchData();
      } else {
        setEnrichResult(`Error: ${json.error ?? "Unknown"}`);
      }
    } catch (e) {
      setEnrichResult(`Network error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setEnrichingId(null);
    }
  }

  async function toggleManual(job: LeadJob) {
    const currentlyEnriched = isEffectivelyEnriched(job);
    const nextState = !currentlyEnriched;

    // Optimistic flip
    setLocalOverrides((prev) => {
      const next = new Map(prev);
      next.set(job.postingId, nextState);
      return next;
    });
    setActingId(job.postingId);

    const endpoint = nextState
      ? "/api/jobs/mark-enriched"
      : "/api/jobs/unmark-enriched";

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postingId: job.postingId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      broadcastEnrichChange();
      await fetchData(); // syncs server state; also clears localOverrides
    } catch {
      // Roll back optimistic change
      setLocalOverrides((prev) => {
        const next = new Map(prev);
        next.set(job.postingId, currentlyEnriched);
        return next;
      });
    } finally {
      setActingId(null);
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground">Loading lead status…</p>
    );
  }
  if (error) {
    return <p className="text-sm text-red-600">Error: {error}</p>;
  }

  const highPending = data?.high.items.filter((j) => !j.isEnriched) ?? [];
  const highEnriched = data?.high.items.filter((j) => j.isEnriched) ?? [];
  const midItems = data?.mid.items ?? [];

  return (
    <div className="space-y-8">
      {/* ── Tier 1: Score ≥ 90 — Clay Auto-Enrichment ── */}
      <section>
        <div className="mb-4 flex flex-col gap-3 rounded-xl border border-amber-900/15 bg-amber-50/50 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="font-semibold text-foreground">
              Score ≥ 90 — Clay Auto-Enrichment
              <span className="ml-2 inline-flex items-center rounded-full bg-amber-200 px-2 py-0.5 text-xs font-medium text-amber-900">
                {data?.high.total ?? 0} jobs
              </span>
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {highPending.length} pending · {highEnriched.length} enriched
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              onClick={toggleAutoEnrich}
              disabled={togglingAuto}
              title={autoEnrich ? "Switch to MANUAL mode" : "Switch to AUTO mode"}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50",
                autoEnrich
                  ? "bg-amber-700 text-white"
                  : "border border-amber-700/40 text-amber-800 hover:bg-amber-50"
              )}
            >
              {togglingAuto ? "…" : autoEnrich ? "AUTO" : "MANUAL"}
            </button>

            {autoEnrich && (
              <button
                onClick={enrichAll}
                disabled={enrichingAll || highPending.length === 0}
                className="rounded-lg bg-gradient-to-r from-amber-700 to-orange-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:from-amber-800 hover:to-orange-700 disabled:opacity-40"
              >
                {enrichingAll ? "Enriching…" : `Enrich all ${highPending.length}`}
              </button>
            )}
          </div>
        </div>

        {enrichResult && (
          <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {enrichResult}
          </p>
        )}

        {highPending.length > 0 && (
          <div className="mb-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700">
              Pending ({highPending.length})
            </h3>
            <div className="space-y-2">
              {highPending.map((job) => (
                <LeadJobRow
                  key={job.postingId}
                  job={job}
                  action={
                    !autoEnrich ? (
                      <button
                        onClick={() => enrichOne(job.postingId)}
                        disabled={enrichingId === job.postingId}
                        className="shrink-0 rounded-lg border border-amber-700/40 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-40"
                      >
                        {enrichingId === job.postingId ? "Enriching…" : "Enrich"}
                      </button>
                    ) : (
                      <span className="shrink-0 text-xs text-amber-600/60">queued</span>
                    )
                  }
                />
              ))}
            </div>
          </div>
        )}

        {highEnriched.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-green-700">
              Enriched ({highEnriched.length})
            </h3>
            <div className="space-y-2">
              {highEnriched.map((job) => (
                <LeadJobRow key={job.postingId} job={job} />
              ))}
            </div>
          </div>
        )}

        {highPending.length === 0 && highEnriched.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No jobs with score ≥ 90 yet. Run the filter to surface high-confidence matches.
          </p>
        )}
      </section>

      <hr className="border-amber-900/15" />

      {/* ── Tier 2: Score 70-89 — Manual Enrichment ── */}
      <section>
        <div className="mb-4 rounded-xl border border-orange-900/15 bg-orange-50/30 p-4">
          <h2 className="font-semibold text-foreground">
            Score 70–89 — Manual Enrichment
            <span className="ml-2 inline-flex items-center rounded-full bg-orange-200 px-2 py-0.5 text-xs font-medium text-orange-900">
              {data?.mid.total ?? 0} jobs
            </span>
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Research contacts yourself, then toggle each job when done. Click again to undo.
          </p>
        </div>

        {midItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">No jobs with score 70–89 yet.</p>
        ) : (
          <div className="space-y-2">
            {midItems.map((job) => {
              const enriched = isEffectivelyEnriched(job);
              const acting = actingId === job.postingId;
              return (
                <LeadJobRow
                  key={job.postingId}
                  job={job}
                  enrichedOverride={enriched}
                  action={
                    <button
                      onClick={() => !acting && toggleManual(job)}
                      disabled={acting}
                      aria-pressed={enriched}
                      title={enriched ? "Click to undo enrichment mark" : "Click to mark as enriched"}
                      className={cn(
                        "shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-medium transition disabled:opacity-40",
                        enriched
                          ? "border-green-600/40 bg-green-50 text-green-700 hover:border-red-400/50 hover:bg-red-50 hover:text-red-700"
                          : "border-orange-700/40 text-orange-800 hover:bg-orange-50"
                      )}
                    >
                      <span
                        className={cn(
                          "inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm border text-[9px] transition",
                          enriched
                            ? "border-green-600 bg-green-600 text-white"
                            : "border-orange-500 bg-white"
                        )}
                      >
                        {enriched && "✓"}
                      </span>
                      {acting
                        ? "Saving…"
                        : enriched
                          ? "Enriched"
                          : "Mark enriched"}
                    </button>
                  }
                />
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function LeadJobRow({
  job,
  enrichedOverride,
  action,
}: {
  job: LeadJob;
  enrichedOverride?: boolean;
  action?: React.ReactNode;
}) {
  const enriched = enrichedOverride ?? job.isEnriched;
  return (
    <div className={cn(
      "flex items-center justify-between gap-3 rounded-lg border bg-white/50 px-4 py-3 transition",
      enriched ? "border-green-200/60" : "border-border/30"
    )}>
      <div className="min-w-0 flex-1">
        <a
          href={job.url}
          target="_blank"
          rel="noreferrer"
          className="block truncate font-medium hover:underline"
        >
          {job.title}
        </a>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{job.company}</span>
          {job.contactEmail && (
            <span className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">
              ✉ {job.contactEmail}
            </span>
          )}
          {!job.contactEmail && job.contactUrl && (
            <a
              href={job.contactUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 hover:underline"
            >
              LinkedIn
            </a>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 font-mono text-xs font-semibold",
            job.score >= 90
              ? "bg-green-100 text-green-800"
              : "bg-orange-100 text-orange-800"
          )}
        >
          {job.score}
        </span>
        {action}
      </div>
    </div>
  );
}
