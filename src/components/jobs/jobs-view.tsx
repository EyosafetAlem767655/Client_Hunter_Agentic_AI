"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { JobRow } from "./jobs-table";

export type { JobRow };

// ─── Constants ────────────────────────────────────────────────────────────────

const TOKEN_KEY = "talentbridge_admin_token";

const SUB_FILTERS = [
  { label: "All",        value: "all" },
  { label: "Relevant",   value: "relevant" },
  { label: "Pending AI", value: "unfiltered" },
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

// ─── FeedbackSection (inline in Sheet) ───────────────────────────────────────

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
    <div className="mt-4 rounded-lg border border-border/40 p-4">
      <h4 className="mb-3 text-sm font-semibold">Rate this classification</h4>
      <div className="flex gap-1.5">
        {(["1", "2", "3", "4", "5"] as const).map((r) => {
          const meta = RATING_META[r];
          const isActive = selected === r;
          return (
            <button
              key={r}
              onClick={() => handleRating(r)}
              title={meta.label}
              className={cn(
                "flex flex-col items-center rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition",
                isActive ? meta.activeClass : `border-border/40 text-muted-foreground ${meta.hoverClass}`
              )}
            >
              <span className="text-sm font-bold">{r}</span>
              <span className="text-[10px] font-normal leading-tight">{meta.label}</span>
            </button>
          );
        })}
      </div>
      <textarea
        value={notes}
        onChange={(e) => { setNotes(e.target.value); setSaved(false); setShowRequired(false); }}
        placeholder="Comment required — justify your rating"
        className={cn(
          "mt-3 w-full resize-none rounded-lg border bg-transparent p-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/30",
          showRequired ? "border-red-400" : "border-border/40"
        )}
        rows={2}
      />
      {showRequired && <p className="mt-1 text-xs text-red-600">Add a comment before saving</p>}
      <div className="mt-2 flex items-center justify-between">
        {saved ? <span className="text-xs font-medium text-green-700">✓ Saved</span> : <span />}
        <button
          onClick={save}
          disabled={!selected || saving}
          className="rounded-lg bg-amber-700 px-3 py-1.5 text-sm text-white transition hover:bg-amber-800 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface JobsViewProps {
  jobs: JobRow[];
  total: number;
  currentPage: number;
  totalPages: number;
  activeFilter: string;
  activeWindow: string;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function JobsView({
  jobs: initialJobs,
  total,
  currentPage,
  totalPages,
  activeFilter,
  activeWindow,
}: JobsViewProps) {
  // Local jobs state so enrichment updates reflect immediately without re-fetch
  const [jobs, setJobs] = useState<JobRow[]>(initialJobs);
  const [selected, setSelected] = useState<JobRow | null>(null);

  // Enrichment
  const [enrichingId, setEnrichingId] = useState<number | null>(null);
  const [enrichResults, setEnrichResults] = useState<Record<number, string>>({});
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);

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

    const eligible = jobs.filter((j) => (j.score ?? 0) >= 60 && !j.isEnriched);
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

  // Normalise activeFilter: legacy "lead-status" / "enrichment" → "all"
  const normalised = SUB_FILTERS.some((f) => f.value === activeFilter) ? activeFilter : "all";

  const eligibleCount = jobs.filter((j) => (j.score ?? 0) >= 60 && !j.isEnriched).length;

  return (
    <div className="space-y-4">
      {/* Sub-filter chips + Enrich All row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-amber-900/15 bg-white/50 p-1 backdrop-blur">
          {SUB_FILTERS.map((f) => (
            <Link
              key={f.value}
              href={{
                pathname: "/jobs",
                query: {
                  ...(f.value !== "all" ? { status: f.value } : {}),
                  window: activeWindow,
                },
              }}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm transition",
                normalised === f.value
                  ? "bg-gradient-to-r from-amber-700 to-orange-600 text-white shadow"
                  : "text-foreground/70 hover:text-foreground"
              )}
            >
              {f.label}
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
                  ) : (job.score ?? 0) >= 60 ? (
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
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
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
              href={{ pathname: "/jobs", query: { ...(normalised !== "all" ? { status: normalised } : {}), window: activeWindow, page: currentPage - 1 } }}
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
              href={{ pathname: "/jobs", query: { ...(normalised !== "all" ? { status: normalised } : {}), window: activeWindow, page: currentPage + 1 } }}
              className="rounded-lg border border-border/40 px-3 py-1.5 text-sm hover:bg-accent/20 transition"
            >
              Next →
            </Link>
          )}
        </div>
      )}

      {/* Job detail Sheet */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetTrigger className="hidden" />
        <SheetContent>
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.title}</SheetTitle>
              </SheetHeader>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>{selected.company}</span>
                <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                  {selected.sourceLabel}
                </span>
                <ScoreBadge score={selected.score} />
              </div>
              <a
                href={selected.url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 block text-sm text-primary hover:underline"
              >
                View posting ↗
              </a>
              {selected.fitReason && (
                <div className="mt-4 rounded-lg bg-muted/40 p-4">
                  <h4 className="text-sm font-semibold">LLM reasoning</h4>
                  <p className="mt-2 text-sm text-muted-foreground">{selected.fitReason}</p>
                </div>
              )}
              <FeedbackSection key={selected.id} job={selected} />
              <div className="mt-4 max-h-96 overflow-y-auto whitespace-pre-wrap text-sm">
                {selected.description.slice(0, 3000)}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
