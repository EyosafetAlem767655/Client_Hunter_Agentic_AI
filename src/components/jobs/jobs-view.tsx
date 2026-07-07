"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { JobRow } from "./jobs-table";

export type { JobRow };

// ─── Constants ────────────────────────────────────────────────────────────────

const TOKEN_KEY = "talentbridge_admin_token";

const SORT_MODES = [
  { label: "All",           value: "all" },
  { label: "By Relevancy",  value: "relevancy" },
  { label: "By Recentness", value: "recentness" },
] as const;

const RATING_META: Record<string, { label: string; activeClass: string; hoverClass: string }> = {
  "1": { label: "Very bad",  activeClass: "border-red-700/60 bg-red-100 text-red-800",      hoverClass: "hover:border-red-600/40 hover:bg-red-50 hover:text-red-800" },
  "2": { label: "Bad",       activeClass: "border-red-500/60 bg-red-50 text-red-700",       hoverClass: "hover:border-red-400/40 hover:bg-red-50 hover:text-red-700" },
  "3": { label: "Okay",      activeClass: "border-amber-500/60 bg-amber-50 text-amber-800", hoverClass: "hover:border-amber-400/40 hover:bg-amber-50 hover:text-amber-800" },
  "4": { label: "Good",      activeClass: "border-green-500/60 bg-green-50 text-green-800", hoverClass: "hover:border-green-400/40 hover:bg-green-50 hover:text-green-800" },
  "5": { label: "Excellent", activeClass: "border-green-700/60 bg-green-100 text-green-900", hoverClass: "hover:border-green-600/40 hover:bg-green-100 hover:text-green-900" },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        Pending
      </span>
    );
  }
  const cls =
    score >= 80
      ? "bg-green-100 text-green-800"
      : score >= 60
        ? "bg-amber-100 text-amber-800"
        : score >= 40
          ? "bg-orange-100 text-orange-800"
          : "bg-red-100 text-red-700";
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", cls)}>
      {score}
    </span>
  );
}

// ─── FeedbackSection ─────────────────────────────────────────────────────────

function FeedbackSection({ job }: { job: JobRow }) {
  const [selected, setSelected] = useState<string | null>(job.userFeedback ?? null);
  const [notes, setNotes] = useState(job.userNotes ?? "");
  const [saved, setSaved] = useState(!!job.userFeedback);
  const [saving, setSaving] = useState(false);
  const [showRequired, setShowRequired] = useState(false);

  async function save() {
    if (!selected) return;
    if (!notes.trim()) { setShowRequired(true); return; }
    setShowRequired(false);
    setSaving(true);
    try {
      const res = await fetch("/api/jobs/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postingId: job.id, feedback: selected, notes: notes.trim() }),
      });
      if (res.ok) setSaved(true);
    } catch { /* ignore */ } finally { setSaving(false); }
  }

  function handleRating(rating: string) { setSelected(rating); setSaved(false); setShowRequired(false); }

  return (
    <div className="rounded-xl border border-amber-900/20 bg-amber-50/40 p-5">
      <h4 className="mb-1 text-sm font-bold uppercase tracking-wide text-amber-900/70">
        Rate this classification (RHLF)
      </h4>
      <p className="mb-3 text-xs text-muted-foreground">
        Your rating trains the AI to score future jobs more accurately.
      </p>
      <div className="flex gap-2">
        {(["1", "2", "3", "4", "5"] as const).map((r) => {
          const meta = RATING_META[r];
          const isActive = selected === r;
          return (
            <button
              key={r}
              onClick={() => handleRating(r)}
              title={meta.label}
              className={cn(
                "flex flex-col items-center rounded-xl border px-3 py-2 text-xs font-semibold transition",
                isActive ? meta.activeClass : `border-border/40 text-muted-foreground ${meta.hoverClass}`
              )}
            >
              <span className="text-base font-bold">{r}</span>
              <span className="text-[10px] font-normal leading-tight">{meta.label}</span>
            </button>
          );
        })}
      </div>
      <textarea
        value={notes}
        onChange={(e) => { setNotes(e.target.value); setSaved(false); setShowRequired(false); }}
        placeholder="Comment required — explain why this rating fits"
        className={cn(
          "mt-3 w-full resize-none rounded-xl border bg-white/60 p-3 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-amber-400/40",
          showRequired ? "border-red-400" : "border-border/40"
        )}
        rows={3}
      />
      {showRequired && <p className="mt-1 text-xs text-red-600">Add a comment before saving</p>}
      <div className="mt-3 flex items-center justify-between">
        {saved ? <span className="text-sm font-medium text-green-700">✓ Feedback saved</span> : <span />}
        <button
          onClick={save}
          disabled={!selected || saving}
          className="rounded-xl bg-amber-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-800 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save Feedback"}
        </button>
      </div>
    </div>
  );
}

// ─── Full-screen Job Detail Modal ─────────────────────────────────────────────

interface JobDetailModalProps {
  job: JobRow;
  enrichingId: number | null;
  enrichResults: Record<number, string>;
  onClose: () => void;
  onEnrich: (job: JobRow) => void;
}

function JobDetailModal({ job, enrichingId, enrichResults, onClose, onEnrich }: JobDetailModalProps) {
  // Lock body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Escape key to close
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  }, [onClose]);
  useEffect(() => {
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  const scoreColor =
    job.score === null ? ""
    : job.score >= 80 ? "text-green-700"
    : job.score >= 60 ? "text-amber-700"
    : job.score >= 40 ? "text-orange-700"
    : "text-red-700";

  const enrichResult = enrichResults[job.id];

  const modal = (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        background: "hsl(36, 35%, 92%)",
      }}
    >
      {/* Backdrop click — only on the overlay itself, not its children */}
      <div
        style={{ position: "fixed", inset: 0, zIndex: -1, background: "rgba(0,0,0,0.5)" }}
        onClick={onClose}
      />

      {/* Modal panel */}
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          background: "hsl(36, 35%, 92%)",
          overflow: "hidden",
        }}
      >
        {/* ── Fixed header ── */}
        <div
          style={{
            flexShrink: 0,
            borderBottom: "1px solid rgba(120, 80, 30, 0.15)",
            padding: "1.25rem 1.5rem",
            background: "hsl(36, 38%, 90%)",
          }}
        >
          {/* Close button */}
          <button
            onClick={onClose}
            style={{
              position: "absolute",
              top: "1rem",
              right: "1rem",
              width: "2rem",
              height: "2rem",
              borderRadius: "9999px",
              border: "1px solid rgba(120,80,30,0.2)",
              background: "rgba(120,80,30,0.08)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "1.1rem",
              color: "#6b4c2a",
            }}
            aria-label="Close"
          >
            ✕
          </button>

          {/* Title */}
          <h1 style={{ fontSize: "1.35rem", fontWeight: 700, paddingRight: "2.5rem", color: "hsl(24, 35%, 18%)", lineHeight: 1.3 }}>
            {job.title}
          </h1>

          {/* Meta row */}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{job.company}</span>
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
              {job.sourceLabel}
            </span>
            {job.scrapedAt && (
              <span className="text-xs">{relativeTime(job.scrapedAt)}</span>
            )}
            <ScoreBadge score={job.score} />
          </div>

          {/* Action row */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <a
              href={job.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-amber-700/30 bg-amber-700/10 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-700/20 transition"
            >
              View original posting ↗
            </a>

            {job.isEnriched ? (
              <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-100 px-3 py-1.5 text-xs font-medium text-emerald-800">
                ✓ {enrichResult ?? "Enriched"}
              </span>
            ) : (
              <button
                onClick={() => onEnrich(job)}
                disabled={enrichingId === job.id}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 transition"
              >
                {enrichingId === job.id ? (
                  <>
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
                    Enriching…
                  </>
                ) : (
                  <>⚡ Enrich with Clay</>
                )}
              </button>
            )}

            {enrichResult && !job.isEnriched && (
              <span className={cn("text-xs font-medium", enrichResult.startsWith("Error") ? "text-red-600" : "text-emerald-700")}>
                {enrichResult}
              </span>
            )}
          </div>
        </div>

        {/* ── Scrollable body ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "1.5rem" }}>
          <div className="mx-auto max-w-4xl space-y-8">

            {/* Score + AI Reasoning */}
            <section className="rounded-xl border border-amber-900/15 bg-white/50 p-6">
              <h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-amber-900/60">
                AI Relevancy Score &amp; Reasoning
              </h2>

              {/* Score display */}
              <div className="mb-4 flex items-baseline gap-2">
                {job.score !== null ? (
                  <>
                    <span className={cn("text-5xl font-black tabular-nums", scoreColor)}>
                      {job.score}
                    </span>
                    <span className="text-xl text-muted-foreground font-normal">/ 100</span>
                    <span className={cn(
                      "ml-2 rounded-full px-3 py-1 text-sm font-semibold",
                      job.score >= 80 ? "bg-green-100 text-green-800"
                        : job.score >= 60 ? "bg-amber-100 text-amber-800"
                        : job.score >= 40 ? "bg-orange-100 text-orange-800"
                        : "bg-red-100 text-red-700"
                    )}>
                      {job.score >= 80 ? "Strong Match"
                        : job.score >= 60 ? "Good Match"
                        : job.score >= 40 ? "Partial Match"
                        : "Low Match"}
                    </span>
                  </>
                ) : (
                  <span className="text-lg text-muted-foreground italic">
                    Not yet scored — run the filter pipeline to get an AI score.
                  </span>
                )}
              </div>

              {/* Reasoning */}
              {job.fitReason ? (
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-foreground/70">Why the AI scored it this way:</h3>
                  <p className="text-base leading-relaxed text-foreground/85 whitespace-pre-wrap">
                    {job.fitReason}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  No AI reasoning available yet. The job hasn&apos;t been through the relevancy filter pipeline.
                </p>
              )}
            </section>

            {/* RHLF Feedback */}
            <section>
              <FeedbackSection key={job.id} job={job} />
            </section>

            {/* Full Job Description */}
            <section className="rounded-xl border border-amber-900/15 bg-white/50 p-6">
              <h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-amber-900/60">
                Full Job Description
              </h2>
              {job.description ? (
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/85">
                  {job.description}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">No description available for this posting.</p>
              )}
            </section>

          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface JobsViewProps {
  jobs: JobRow[];
  total: number;
  currentPage: number;
  totalPages: number;
  activeSort: string;
  activeWindow: string;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function JobsView({
  jobs: initialJobs,
  total,
  currentPage,
  totalPages,
  activeSort,
  activeWindow,
}: JobsViewProps) {
  const [jobs, setJobs] = useState<JobRow[]>(initialJobs);
  const [selected, setSelected] = useState<JobRow | null>(null);

  // Enrichment
  const [enrichingId, setEnrichingId] = useState<number | null>(null);
  const [enrichResults, setEnrichResults] = useState<Record<number, string>>({});
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);

  // Sync & Re-analyze
  const [syncRunning, setSyncRunning] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  // Admin token prompt
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [tokenDraft, setTokenDraft] = useState("");

  function getToken(): string {
    return typeof window !== "undefined" ? (sessionStorage.getItem(TOKEN_KEY) ?? "") : "";
  }

  function saveToken() {
    if (!tokenDraft.trim()) return;
    sessionStorage.setItem(TOKEN_KEY, tokenDraft.trim());
    setShowTokenInput(false);
    setTokenDraft("");
  }

  async function enrichOne(job: JobRow) {
    const token = getToken();
    if (!token) { setShowTokenInput(true); return; }

    setEnrichingId(job.id);
    setEnrichResults((prev) => { const n = { ...prev }; delete n[job.id]; return n; });
    try {
      const res = await fetch("/api/admin/enrich", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ postingId: job.id }),
      });
      const json = (await res.json()) as { ok?: boolean; contactsSaved?: number; error?: string };
      if (json.ok) {
        setEnrichResults((prev) => ({ ...prev, [job.id]: `✓ ${json.contactsSaved ?? 0} contact(s)` }));
        setJobs((prev) => prev.map((j) => j.id === job.id ? { ...j, isEnriched: true } : j));
        // Update selected if it's the one being enriched
        setSelected((prev) => prev?.id === job.id ? { ...prev, isEnriched: true } : prev);
      } else {
        setEnrichResults((prev) => ({ ...prev, [job.id]: `Error: ${json.error ?? "Unknown"}` }));
      }
    } catch (e) {
      setEnrichResults((prev) => ({ ...prev, [job.id]: `Error: ${e instanceof Error ? e.message : String(e)}` }));
    } finally {
      setEnrichingId(null);
    }
  }

  async function enrichAllEligible() {
    const token = getToken();
    if (!token) { setShowTokenInput(true); return; }

    const eligible = jobs.filter((j) => !j.isEnriched);
    if (eligible.length === 0) return;

    setBulkRunning(true);
    let done = 0;
    for (const job of eligible) {
      setBulkProgress(`Enriching ${done + 1} / ${eligible.length}…`);
      await enrichOne(job);
      done++;
    }
    setBulkProgress(`Done — ${done} enriched`);
    setBulkRunning(false);
  }

  async function syncAndReanalyze() {
    const token = getToken();
    if (!token) { setShowTokenInput(true); return; }

    setSyncRunning(true);
    setSyncStatus("Fetching full descriptions from job sites…");
    try {
      const syncRes = await fetch("/api/admin/sync/descriptions?n=30", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const syncJson = (await syncRes.json()) as { ok?: boolean; updated?: number; total?: number; error?: string };
      if (!syncJson.ok) {
        setSyncStatus(`Sync failed: ${syncJson.error ?? "unknown error"}`);
        return;
      }
      setSyncStatus(`Updated ${syncJson.updated ?? 0}/${syncJson.total ?? 0} descriptions. Re-running AI analysis…`);

      // Run filter loop until no more unfiltered/stale jobs (cap at 20 batches)
      let filterTotal = 0;
      for (let i = 0; i < 20; i++) {
        const filterRes = await fetch("/api/manual/filter/next?n=8", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        });
        const filterJson = (await filterRes.json()) as { ok?: boolean; done?: boolean; step?: { processed?: number } };
        if (!filterJson.ok || filterJson.done) break;
        filterTotal += filterJson.step?.processed ?? 0;
        setSyncStatus(`AI analysis running… ${filterTotal} jobs re-analyzed`);
      }

      setSyncStatus(`Done — ${syncJson.updated ?? 0} descriptions synced, ${filterTotal} jobs re-analyzed. Refresh the page to see updated reasoning.`);
    } catch (e) {
      setSyncStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncRunning(false);
    }
  }

  const normalised = SORT_MODES.some((m) => m.value === activeSort) ? activeSort : "all";

  const eligibleCount = jobs.filter((j) => !j.isEnriched).length;

  return (
    <>
      <div className="space-y-4">
        {/* Sub-filter chips + Enrich All row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-xl border border-amber-900/15 bg-white/50 p-1 backdrop-blur">
            {SORT_MODES.map((m) => (
              <Link
                key={m.value}
                href={{
                  pathname: "/jobs",
                  query: {
                    ...(m.value !== "all" ? { sort: m.value } : {}),
                    window: activeWindow,
                  },
                }}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm transition",
                  normalised === m.value
                    ? "bg-gradient-to-r from-amber-700 to-orange-600 text-white shadow"
                    : "text-foreground/70 hover:text-foreground"
                )}
              >
                {m.label}
              </Link>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {showTokenInput ? (
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  value={tokenDraft}
                  onChange={(e) => setTokenDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveToken()}
                  placeholder="Paste admin token…"
                  className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
                />
                <button
                  onClick={saveToken}
                  className="rounded-lg bg-amber-700 px-3 py-1.5 text-sm text-white hover:bg-amber-800 transition"
                >
                  Save
                </button>
                <button
                  onClick={() => setShowTokenInput(false)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            ) : (
              eligibleCount > 0 && (
                <button
                  onClick={enrichAllEligible}
                  disabled={bulkRunning}
                  className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 transition"
                >
                  {bulkRunning
                    ? (bulkProgress ?? "Enriching…")
                    : `Enrich All Eligible (${eligibleCount})`}
                </button>
              )
            )}
            {!bulkRunning && bulkProgress && (
              <span className="text-xs font-medium text-emerald-700">{bulkProgress}</span>
            )}

            {/* Sync & Re-analyze button */}
            {!showTokenInput && (
              <button
                onClick={syncAndReanalyze}
                disabled={syncRunning}
                className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-800 hover:bg-blue-100 disabled:opacity-50 transition"
                title="Re-fetch job descriptions from source sites and re-run AI scoring with detailed reasoning"
              >
                {syncRunning ? "Syncing…" : "↻ Sync & Re-analyze"}
              </button>
            )}
            {syncStatus && (
              <span className={cn(
                "text-xs font-medium",
                syncStatus.startsWith("Error") ? "text-red-600" : "text-blue-700"
              )}>
                {syncStatus}
              </span>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="glass-card overflow-hidden rounded-xl">
          <table className="w-full text-sm">
            <thead className="border-b border-border/50 bg-muted/30 text-left text-muted-foreground">
              <tr>
                <th className="p-4">Title</th>
                <th className="p-4">Company</th>
                <th className="p-4">Source</th>
                <th className="p-4 whitespace-nowrap">Scraped</th>
                <th className="p-4">Score</th>
                <th className="p-4">Status</th>
                <th className="p-4">Enrichment</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    No jobs match this filter yet.
                  </td>
                </tr>
              )}
              {jobs.map((job) => (
                <tr
                  key={job.id}
                  className="cursor-pointer border-b border-border/30 transition-colors hover:bg-accent/20"
                  onClick={() => setSelected(job)}
                >
                  {/* Title */}
                  <td className="p-4 font-medium">
                    <span className="flex items-center gap-1.5">
                      {job.userFeedback && (
                        <span
                          title={`Your rating: ${job.userFeedback}/5`}
                          className={cn(
                            "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-bold ring-2 shadow-sm",
                            ["1", "2"].includes(job.userFeedback)
                              ? "bg-red-100 text-red-700 ring-red-300"
                              : job.userFeedback === "3"
                                ? "bg-amber-100 text-amber-700 ring-amber-300"
                                : "bg-green-100 text-green-800 ring-green-300"
                          )}
                        >
                          <span>★</span><span>{job.userFeedback}</span>
                        </span>
                      )}
                      {job.title}
                    </span>
                  </td>

                  {/* Company */}
                  <td className="p-4">{job.company}</td>

                  {/* Source */}
                  <td className="p-4">
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                      {job.sourceLabel}
                    </span>
                  </td>

                  {/* Scraped */}
                  <td className="p-4 whitespace-nowrap text-xs text-muted-foreground">
                    {job.scrapedAt ? relativeTime(job.scrapedAt) : "—"}
                  </td>

                  {/* Score */}
                  <td className="p-4">
                    <ScoreBadge score={job.score} />
                  </td>

                  {/* Status */}
                  <td className="p-4">
                    {job.isRelevant === null ? (
                      <Badge variant="outline">Unfiltered</Badge>
                    ) : job.isRelevant ? (
                      <Badge>Relevant</Badge>
                    ) : (
                      <Badge variant="secondary">Skipped</Badge>
                    )}
                  </td>

                  {/* Enrichment */}
                  <td className="p-4" onClick={(e) => e.stopPropagation()}>
                    {job.isEnriched ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                        {enrichResults[job.id] ?? "Enriched"}
                      </span>
                    ) : (
                      <div className="flex flex-col gap-0.5">
                        <button
                          onClick={() => enrichOne(job)}
                          disabled={enrichingId === job.id}
                          className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 transition"
                        >
                          {enrichingId === job.id ? "…" : "Enrich"}
                        </button>
                        {enrichResults[job.id] && (
                          <span className={cn(
                            "text-[10px]",
                            enrichResults[job.id].startsWith("Error") ? "text-red-600" : "text-emerald-700"
                          )}>
                            {enrichResults[job.id]}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-1">
            {currentPage > 1 && (
              <Link
                href={{ pathname: "/jobs", query: { ...(normalised !== "all" ? { sort: normalised } : {}), window: activeWindow, page: currentPage - 1 } }}
                className="rounded-lg border border-border/40 px-3 py-1.5 text-sm hover:bg-accent/20 transition"
              >
                ← Prev
              </Link>
            )}
            <span className="px-3 text-sm text-muted-foreground">
              Page {currentPage} of {totalPages}
            </span>
            {currentPage < totalPages && (
              <Link
                href={{ pathname: "/jobs", query: { ...(normalised !== "all" ? { sort: normalised } : {}), window: activeWindow, page: currentPage + 1 } }}
                className="rounded-lg border border-border/40 px-3 py-1.5 text-sm hover:bg-accent/20 transition"
              >
                Next →
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Full-screen job detail modal (portal to body) */}
      {selected && (
        <JobDetailModal
          job={selected}
          enrichingId={enrichingId}
          enrichResults={enrichResults}
          onClose={() => setSelected(null)}
          onEnrich={enrichOne}
        />
      )}
    </>
  );
}
