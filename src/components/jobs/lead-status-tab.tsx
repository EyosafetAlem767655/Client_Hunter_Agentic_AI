"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
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

export function LeadStatusTab() {
  const router = useRouter();
  const [items, setItems] = useState<LeadJob[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [enrichingId, setEnrichingId] = useState<number | null>(null);
  const [enrichResult, setEnrichResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs/lead-status", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { items: LeadJob[]; total: number };
      setItems(json.items);
      setTotal(json.total);
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
        setEnrichResult(`Enriched · ${json.contactsSaved ?? 0} contact(s) saved`);
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

  function viewDetails(postingId: number) {
    router.push(`/jobs?status=enrichment&job=${postingId}`);
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading lead status…</p>;
  }
  if (error) {
    return <p className="text-sm text-red-600">Error: {error}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-amber-900/15 bg-amber-50/50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold text-foreground">
            Lead Status — score ≥ 60
            <span className="ml-2 inline-flex items-center rounded-full bg-amber-200 px-2 py-0.5 text-xs font-medium text-amber-900">
              {total} jobs
            </span>
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Click Enrich on any job to look up company info and lead contacts via Clay.
          </p>
        </div>
      </div>

      {enrichResult && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {enrichResult}
        </p>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No jobs with score ≥ 60 yet. Run the filter to surface matches.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((job) => (
            <div
              key={job.postingId}
              className={cn(
                "flex items-center justify-between gap-3 rounded-lg border bg-white/50 px-4 py-3 transition",
                job.isEnriched ? "border-green-200/60" : "border-border/30"
              )}
            >
              <div className="min-w-0 flex-1">
                <a
                  href={job.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate font-medium hover:underline"
                >
                  {job.title}
                </a>
                <span className="text-xs text-muted-foreground">{job.company}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 font-mono text-xs font-semibold",
                    job.score >= 90
                      ? "bg-green-100 text-green-800"
                      : job.score >= 70
                        ? "bg-amber-100 text-amber-800"
                        : "bg-orange-100 text-orange-800"
                  )}
                >
                  {job.score}
                </span>
                {job.isEnriched ? (
                  <button
                    onClick={() => viewDetails(job.postingId)}
                    className="shrink-0 rounded-lg border border-green-600/40 bg-green-50 px-3 py-1 text-xs font-medium text-green-700 hover:bg-green-100 transition"
                  >
                    View Details →
                  </button>
                ) : (
                  <button
                    onClick={() => enrichOne(job.postingId)}
                    disabled={enrichingId === job.postingId}
                    className="shrink-0 rounded-lg border border-amber-700/40 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-40 transition"
                  >
                    {enrichingId === job.postingId ? "Enriching…" : "Enrich"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
