"use client";

import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface JobRow {
  id: number;
  title: string;
  company: string;
  source: string;
  sourceLabel: string;
  score: number | null;
  isRelevant: boolean | null;
  fitReason: string | null;
  description: string;
  url: string;
  scrapedAt?: string | null;
  contactEmail?: string | null;
  contactUrl?: string | null;
  userFeedback?: string | null;
  userNotes?: string | null;
  isEnriched?: boolean;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const RATING_META: Record<string, { label: string; activeClass: string; hoverClass: string }> = {
  "1": { label: "Very bad",  activeClass: "border-red-700/60 bg-red-100 text-red-800",   hoverClass: "hover:border-red-600/40 hover:bg-red-50 hover:text-red-800" },
  "2": { label: "Bad",       activeClass: "border-red-500/60 bg-red-50 text-red-700",    hoverClass: "hover:border-red-400/40 hover:bg-red-50 hover:text-red-700" },
  "3": { label: "Okay",      activeClass: "border-amber-500/60 bg-amber-50 text-amber-800", hoverClass: "hover:border-amber-400/40 hover:bg-amber-50 hover:text-amber-800" },
  "4": { label: "Good",      activeClass: "border-green-500/60 bg-green-50 text-green-800", hoverClass: "hover:border-green-400/40 hover:bg-green-50 hover:text-green-800" },
  "5": { label: "Excellent", activeClass: "border-green-700/60 bg-green-100 text-green-900", hoverClass: "hover:border-green-600/40 hover:bg-green-100 hover:text-green-900" },
};

function FeedbackSection({ job }: { job: JobRow }) {
  const [selected, setSelected] = useState<string | null>(job.userFeedback ?? null);
  const [notes, setNotes] = useState(job.userNotes ?? "");
  const [saved, setSaved] = useState(!!job.userFeedback);
  const [saving, setSaving] = useState(false);
  const [showRequired, setShowRequired] = useState(false);

  async function save() {
    if (!selected) return;
    if (!notes.trim()) {
      setShowRequired(true);
      return;
    }
    setShowRequired(false);
    setSaving(true);
    try {
      const res = await fetch("/api/jobs/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postingId: job.id, feedback: selected, notes: notes.trim() }),
      });
      if (res.ok) setSaved(true);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }

  function handleRating(rating: string) {
    setSelected(rating);
    setSaved(false);
    setShowRequired(false);
  }

  const canSave = !!selected && notes.trim().length > 0;

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
                isActive
                  ? meta.activeClass
                  : `border-border/40 text-muted-foreground ${meta.hoverClass}`
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
        placeholder="Comment required — justify your rating (fed back into the AI filter)"
        className={cn(
          "mt-3 w-full resize-none rounded-lg border bg-transparent p-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/30",
          showRequired ? "border-red-400" : "border-border/40"
        )}
        rows={2}
      />
      {showRequired && (
        <p className="mt-1 text-xs text-red-600">Add a comment before saving</p>
      )}
      <div className="mt-2 flex items-center justify-between">
        {saved ? (
          <span className="text-xs font-medium text-green-700">✓ Saved</span>
        ) : (
          <span />
        )}
        <button
          onClick={save}
          disabled={!selected || saving || (!canSave && !showRequired)}
          className="rounded-lg bg-amber-700 px-3 py-1.5 text-sm text-white transition hover:bg-amber-800 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

export function JobsTable({ jobs }: { jobs: JobRow[] }) {
  const [selected, setSelected] = useState<JobRow | null>(null);

  return (
    <>
      <div className="glass-card overflow-hidden rounded-xl">
        <table className="w-full text-sm">
          <thead className="border-b border-border/50 bg-muted/30 text-left text-muted-foreground">
            <tr>
              <th className="p-4">Title</th>
              <th className="p-4">Company</th>
              <th className="p-4">Source</th>
              <th className="p-4">Scraped</th>
              <th className="p-4">Contact</th>
              <th className="p-4">Score</th>
              <th className="p-4">Status</th>
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
                <td className="p-4 font-medium">
                  <span className="flex items-center gap-1.5">
                    {job.userFeedback && (
                      <span
                        title={`Your rating: ${job.userFeedback}/5 — ${RATING_META[job.userFeedback]?.label ?? ""}`}
                        className={cn(
                          "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-bold ring-2 shadow-sm",
                          ["1", "2"].includes(job.userFeedback)
                            ? "bg-red-100 text-red-700 ring-red-300"
                            : job.userFeedback === "3"
                              ? "bg-amber-100 text-amber-700 ring-amber-300"
                              : "bg-green-100 text-green-800 ring-green-300"
                        )}
                      >
                        <span>★</span>
                        <span>{job.userFeedback}</span>
                      </span>
                    )}
                    {job.title}
                  </span>
                </td>
                <td className="p-4">{job.company}</td>
                <td className="p-4">
                  <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                    {job.sourceLabel}
                  </span>
                </td>
                <td className="p-4 whitespace-nowrap text-xs text-muted-foreground">
                  {job.scrapedAt ? relativeTime(job.scrapedAt) : "—"}
                </td>
                <td className="p-4 text-xs">
                  {job.contactEmail ? (
                    <span className="rounded bg-amber-200 px-2 py-0.5 text-amber-900">
                      {job.contactEmail}
                    </span>
                  ) : job.contactUrl ? (
                    <a
                      href={job.contactUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded bg-orange-100 px-2 py-0.5 text-orange-900 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      URL only
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          (job.score ?? 0) >= 70
                            ? "bg-amber-700"
                            : (job.score ?? 0) >= 40
                              ? "bg-orange-500"
                              : "bg-red-500"
                        )}
                        style={{ width: `${job.score ?? 0}%` }}
                      />
                    </div>
                    <span className="font-mono text-xs">{job.score ?? "—"}</span>
                  </div>
                </td>
                <td className="p-4">
                  {job.isRelevant === null ? (
                    <Badge variant="outline">Unfiltered</Badge>
                  ) : job.isRelevant ? (
                    <Badge>Relevant</Badge>
                  ) : (
                    <Badge variant="secondary">Skipped</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
              </div>
              <a
                href={selected.url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 block text-sm text-primary hover:underline"
              >
                View posting
              </a>
              {selected.fitReason && (
                <div className="mt-4 rounded-lg bg-muted/40 p-4">
                  <h4 className="text-sm font-semibold">LLM reasoning</h4>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {selected.fitReason}
                  </p>
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
    </>
  );
}
