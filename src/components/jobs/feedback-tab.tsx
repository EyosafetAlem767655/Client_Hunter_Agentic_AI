"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

const TOKEN_KEY = "talentbridge_admin_token";

const RATING_COLORS: Record<string, string> = {
  "1": "bg-red-100 text-red-700 ring-red-300",
  "2": "bg-red-50 text-red-600 ring-red-200",
  "3": "bg-amber-100 text-amber-700 ring-amber-300",
  "4": "bg-green-50 text-green-700 ring-green-200",
  "5": "bg-green-100 text-green-800 ring-green-300",
};

const RATING_LABEL: Record<string, string> = {
  "1": "Very bad",
  "2": "Bad",
  "3": "Okay",
  "4": "Good",
  "5": "Excellent",
};

export interface FeedbackEntry {
  postingId: number;
  title: string;
  company: string;
  description: string;
  url: string;
  userFeedback: string | null;
  userNotes: string | null;
  feedbackAt: Date | string | null;
  isRelevant: boolean;
  fitReason: string | null;
}

interface TrainResponse {
  ok: boolean;
  count?: number;
  summary?: string;
  disqualifiers?: string[];
  positiveSignals?: string[];
  additionalContext?: string;
  trainedAt?: string;
  error?: string;
}

interface Props {
  entries: FeedbackEntry[];
  lastTrainedAt: string | null;
}

export function FeedbackTab({ entries, lastTrainedAt }: Props) {
  const [training, setTraining] = useState(false);
  const [result, setResult] = useState<TrainResponse | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [currentTrainedAt, setCurrentTrainedAt] = useState<string | null>(lastTrainedAt);

  function isEntryTrained(entry: FeedbackEntry): boolean {
    if (!currentTrainedAt || !entry.feedbackAt) return false;
    const trainedTime = new Date(currentTrainedAt).getTime();
    const feedbackTime = new Date(entry.feedbackAt).getTime();
    return feedbackTime <= trainedTime;
  }

  async function runTraining() {
    const token =
      typeof window !== "undefined" ? sessionStorage.getItem(TOKEN_KEY) ?? "" : "";
    if (!token) {
      setResult({
        ok: false,
        error: "Paste your ADMIN_TOKEN in Settings first.",
      });
      return;
    }
    setTraining(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/train", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as TrainResponse;
      setResult(data);
      if (data.ok && data.trainedAt) {
        setCurrentTrainedAt(data.trainedAt);
      }
    } catch {
      setResult({ ok: false, error: "Network error — check console." });
    } finally {
      setTraining(false);
    }
  }

  const trained = entries.filter((e) => isEntryTrained(e));
  const pending = entries.filter((e) => !isEntryTrained(e));

  return (
    <div className="space-y-6">
      {/* Header + Train AI button */}
      <div className="glass-card flex flex-col gap-4 rounded-xl p-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">RLHF Feedback ({entries.length} rated jobs)</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Ratings and notes you gave are used as few-shot calibration in every filter run.
            Click <strong>Train AI</strong> to also extract permanent rule improvements.
          </p>
          {currentTrainedAt && (
            <p className="mt-1 text-xs text-green-700">
              Last trained: {new Date(currentTrainedAt).toLocaleString()} ·{" "}
              {trained.length}/{entries.length} entries included
            </p>
          )}
        </div>
        <button
          onClick={runTraining}
          disabled={training || entries.length === 0}
          className={cn(
            "shrink-0 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow transition",
            training
              ? "cursor-wait bg-amber-500"
              : "bg-gradient-to-r from-amber-700 to-orange-600 hover:from-amber-800 hover:to-orange-700 disabled:opacity-50"
          )}
        >
          {training ? "Training…" : "Train AI"}
        </button>
      </div>

      {/* Training result */}
      {result && (
        <div
          className={cn(
            "rounded-xl border p-4 text-sm",
            result.ok
              ? "border-green-400/40 bg-green-50 text-green-900"
              : "border-red-400/40 bg-red-50 text-red-900"
          )}
        >
          {result.ok ? (
            <>
              <p className="font-semibold">
                ✓ AI trained on {result.count} feedback entries
              </p>
              <p className="mt-1">{result.summary}</p>
              {result.disqualifiers && result.disqualifiers.length > 0 && (
                <div className="mt-2">
                  <p className="font-medium text-xs uppercase tracking-wide text-green-700">
                    New disqualifiers added:
                  </p>
                  <ul className="mt-1 list-disc pl-5 space-y-0.5">
                    {result.disqualifiers.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                </div>
              )}
              {result.positiveSignals && result.positiveSignals.length > 0 && (
                <div className="mt-2">
                  <p className="font-medium text-xs uppercase tracking-wide text-green-700">
                    New positive signals:
                  </p>
                  <ul className="mt-1 list-disc pl-5 space-y-0.5">
                    {result.positiveSignals.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
              {result.additionalContext && (
                <p className="mt-2 italic text-green-800">{result.additionalContext}</p>
              )}
            </>
          ) : (
            <p>Error: {result.error}</p>
          )}
        </div>
      )}

      {/* Pending + trained sections */}
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No rated jobs yet. Open a job in the table, give it a rating (1-5) and a comment, then come back here.
        </p>
      ) : (
        <>
          {pending.length > 0 && (
            <FeedbackList
              title={`Pending (${pending.length})`}
              titleClass="text-amber-700"
              entries={pending}
              expandedId={expandedId}
              onToggle={(id) => setExpandedId(expandedId === id ? null : id)}
              badge="pending"
            />
          )}
          {trained.length > 0 && (
            <FeedbackList
              title={`Sent to AI (${trained.length})`}
              titleClass="text-green-700"
              entries={trained}
              expandedId={expandedId}
              onToggle={(id) => setExpandedId(expandedId === id ? null : id)}
              badge="trained"
            />
          )}
        </>
      )}
    </div>
  );
}

function FeedbackList({
  title,
  titleClass,
  entries,
  expandedId,
  onToggle,
  badge,
}: {
  title: string;
  titleClass: string;
  entries: FeedbackEntry[];
  expandedId: number | null;
  onToggle: (id: number) => void;
  badge: "pending" | "trained";
}) {
  return (
    <div>
      <h3 className={cn("mb-3 text-sm font-semibold", titleClass)}>{title}</h3>
      <div className="space-y-3">
        {entries.map((entry) => {
          const rating = entry.userFeedback ?? "?";
          const isExpanded = expandedId === entry.postingId;
          return (
            <div
              key={entry.postingId}
              className="glass-card rounded-xl border border-border/40 p-4"
            >
              <div className="flex flex-wrap items-start gap-3">
                {/* Rating badge */}
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-bold ring-2",
                    RATING_COLORS[rating] ?? "bg-muted text-muted-foreground ring-border"
                  )}
                >
                  <span>★</span>
                  <span>{rating}</span>
                  <span className="text-[10px] font-normal opacity-70">
                    {RATING_LABEL[rating] ?? ""}
                  </span>
                </span>

                {/* Status badge */}
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    badge === "trained"
                      ? "bg-green-100 text-green-700"
                      : "bg-amber-100 text-amber-700"
                  )}
                >
                  {badge === "trained" ? "✓ sent to AI" : "pending"}
                </span>

                {/* AI verdict */}
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium",
                    entry.isRelevant
                      ? "bg-blue-100 text-blue-700"
                      : "bg-slate-100 text-slate-600"
                  )}
                >
                  AI: {entry.isRelevant ? "relevant" : "not relevant"}
                </span>
              </div>

              <div className="mt-2">
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {entry.title}
                </a>
                <span className="ml-2 text-sm text-muted-foreground">{entry.company}</span>
              </div>

              {entry.userNotes && (
                <p className="mt-1.5 rounded-lg bg-muted/40 px-3 py-2 text-sm italic text-muted-foreground">
                  "{entry.userNotes}"
                </p>
              )}

              {entry.fitReason && (
                <p className="mt-1 text-xs text-muted-foreground">
                  AI reasoning: {entry.fitReason}
                </p>
              )}

              {/* Expand/collapse description */}
              <button
                onClick={() => onToggle(entry.postingId)}
                className="mt-2 text-xs text-primary hover:underline"
              >
                {isExpanded ? "Hide" : "Show"} raw description
              </button>

              {isExpanded && (
                <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border/40 bg-muted/20 p-3 text-xs text-muted-foreground">
                  {entry.description}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
