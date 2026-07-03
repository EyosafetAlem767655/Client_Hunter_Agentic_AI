"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

const PRACTICE_TITLES: Record<"solo" | "mid", string[]> = {
  solo: [
    "Owner / Practice Owner",
    "Physician Owner / MD Owner / Dentist Owner",
    "Office Manager / Medical Office Manager",
    "Practice Manager",
  ],
  mid: [
    "Practice Administrator",
    "Practice Manager / Operations Manager",
    "Office Manager / Front Office Manager",
    "Director of Operations",
    "Billing Manager / Revenue Cycle Manager",
  ],
};

interface EnrichedJob {
  postingId: number;
  title: string;
  company: string;
  url: string;
  score: number;
  enrichedAt: string;
  enrichment: {
    companyName: string | null;
    location: string | null;
    website: string | null;
    staffCount: number | null;
    annualRevenue: string | null;
    facilitiesCount: number | null;
    practiceSize: string | null;
  };
}

interface Lead {
  id: number;
  name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  contactUrl: string | null;
}

interface EnrichmentDetail {
  enrichment: EnrichedJob["enrichment"] | null;
  leads: Lead[];
  targetedTitles: string[];
}

interface Props {
  initialJobId?: string;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export function EnrichmentTab({ initialJobId }: Props) {
  const [jobs, setJobs] = useState<EnrichedJob[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(
    initialJobId ? Number(initialJobId) : null
  );
  const [detailCache, setDetailCache] = useState<Map<number, EnrichmentDetail>>(new Map());
  const [loadingDetail, setLoadingDetail] = useState<number | null>(null);
  const [pushResults, setPushResults] = useState<Record<number, string>>({});
  const [pushingId, setPushingId] = useState<number | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      // Reuse the lead-status endpoint but filter to enriched only
      const res = await fetch("/api/jobs/lead-status?pageSize=200", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { items: Array<{ postingId: number; title: string; company: string; url: string; score: number; isEnriched: boolean }>; total: number };
      // Only show enriched items in this tab
      const enrichedItems = json.items.filter((j) => j.isEnriched);

      // Fetch enrichment details for each to get company data
      const enrichedJobs: EnrichedJob[] = [];
      for (const item of enrichedItems) {
        try {
          const detailRes = await fetch(`/api/enrichment/${item.postingId}`, { cache: "no-store" });
          if (!detailRes.ok) continue;
          const detail = (await detailRes.json()) as { enrichment: EnrichedJob["enrichment"] | null; leads: Lead[]; targetedTitles: string[] };
          if (!detail.enrichment) continue;
          enrichedJobs.push({
            postingId: item.postingId,
            title: item.title,
            company: item.company,
            url: item.url,
            score: item.score,
            enrichedAt: (detail.enrichment as unknown as { updatedAt?: string }).updatedAt ?? new Date().toISOString(),
            enrichment: detail.enrichment,
          });
          setDetailCache((prev) => new Map(prev).set(item.postingId, detail));
        } catch {
          // skip if detail fails
        }
      }

      setJobs(enrichedJobs);
      setTotal(enrichedJobs.length);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchJobs();
  }, [fetchJobs]);

  // Auto-expand the job from URL param after load
  useEffect(() => {
    if (initialJobId && jobs.length > 0) {
      const id = Number(initialJobId);
      if (jobs.some((j) => j.postingId === id)) {
        setExpandedId(id);
      }
    }
  }, [initialJobId, jobs]);

  function exportCsv() {
    const header = [
      "Company", "Job Title", "Location", "Website", "Staff", "Revenue",
      "Practice Size", "Facilities", "Contact Name", "Title", "Email", "Phone", "LinkedIn",
    ];
    const rows: string[][] = [header];
    for (const job of jobs) {
      const detail = detailCache.get(job.postingId);
      const e = detail?.enrichment;
      const baseRow = [
        job.company, job.title,
        e?.location ?? "", e?.website ?? "",
        e?.staffCount != null ? String(e.staffCount) : "",
        e?.annualRevenue ?? "",
        e?.practiceSize ?? "",
        e?.facilitiesCount != null ? String(e.facilitiesCount) : "",
      ];
      if (!detail?.leads.length) {
        rows.push([...baseRow, "", "", "", "", ""]);
      } else {
        for (const l of detail.leads) {
          rows.push([...baseRow, l.name ?? "", l.title ?? "", l.email ?? "", l.phone ?? "", l.contactUrl ?? ""]);
        }
      }
    }
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
    a.download = `enrichment-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  async function pushToCrm(postingId: number) {
    setPushingId(postingId);
    setPushResults((prev) => ({ ...prev, [postingId]: "Pushing…" }));
    try {
      const res = await fetch("/api/crm/close/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postingId }),
      });
      const json = await res.json() as { ok?: boolean; leadId?: string; contactsCreated?: number; error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setPushResults((prev) => ({
        ...prev,
        [postingId]: `✓ Pushed to CRM · ${json.contactsCreated ?? 0} contact(s) · ID: ${json.leadId ?? ""}`,
      }));
    } catch (e) {
      setPushResults((prev) => ({
        ...prev,
        [postingId]: `Error: ${e instanceof Error ? e.message : "Push failed"}`,
      }));
    } finally {
      setPushingId(null);
    }
  }

  async function toggleExpand(postingId: number) {
    if (expandedId === postingId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(postingId);
    if (!detailCache.has(postingId)) {
      setLoadingDetail(postingId);
      try {
        const res = await fetch(`/api/enrichment/${postingId}`, { cache: "no-store" });
        if (res.ok) {
          const detail = (await res.json()) as EnrichmentDetail;
          setDetailCache((prev) => new Map(prev).set(postingId, detail));
        }
      } finally {
        setLoadingDetail(null);
      }
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading enrichment data…</p>;
  }
  if (error) {
    return <p className="text-sm text-red-600">Error: {error}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-emerald-900/15 bg-emerald-50/40 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold text-foreground">
            Enrichment Details
            <span className="ml-2 inline-flex items-center rounded-full bg-emerald-200 px-2 py-0.5 text-xs font-medium text-emerald-900">
              {total} enriched
            </span>
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Click a row to expand company data, targeted job titles, and lead contacts.
          </p>
        </div>
        {jobs.length > 0 && (
          <button
            onClick={exportCsv}
            className="shrink-0 rounded-lg border border-emerald-300/60 bg-white/70 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-50 transition"
          >
            ↓ Export CSV
          </button>
        )}
      </div>

      {jobs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/40 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No enriched jobs yet. Go to Lead Status and click Enrich on a job.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => {
            const isExpanded = expandedId === job.postingId;
            const detail = detailCache.get(job.postingId);

            return (
              <div
                key={job.postingId}
                className="overflow-hidden rounded-lg border border-emerald-200/60 bg-white/50"
              >
                {/* Row header */}
                <button
                  onClick={() => toggleExpand(job.postingId)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-emerald-50/50"
                >
                  <span className="flex-shrink-0 rounded-md bg-emerald-100 p-1">
                    {isExpanded
                      ? <ChevronUp className="h-4 w-4 text-emerald-700" />
                      : <ChevronDown className="h-4 w-4 text-emerald-700" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <a
                      href={job.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="block truncate font-medium hover:underline"
                    >
                      {job.title}
                    </a>
                    <span className="text-xs text-muted-foreground">{job.company}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      enriched {formatDate(job.enrichedAt)}
                    </span>
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
                  </div>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-emerald-200/60 bg-emerald-50/20 px-4 py-4 space-y-5">
                    {loadingDetail === job.postingId ? (
                      <p className="text-sm text-muted-foreground">Loading details…</p>
                    ) : detail ? (
                      <>
                        {/* Push to CRM row */}
                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            onClick={() => pushToCrm(job.postingId)}
                            disabled={pushingId === job.postingId}
                            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition"
                          >
                            {pushingId === job.postingId ? "Pushing…" : "Push to CRM ↗"}
                          </button>
                          {pushResults[job.postingId] && (
                            <span className={cn("text-xs",
                              pushResults[job.postingId].startsWith("Error")
                                ? "text-red-600" : "text-blue-700"
                            )}>
                              {pushResults[job.postingId]}
                            </span>
                          )}
                        </div>

                        {/* Company Enrichment */}
                        <section>
                          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                            Company Enrichment
                          </h3>
                          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
                            <DataField label="Name" value={detail.enrichment?.companyName} />
                            <DataField label="Location" value={detail.enrichment?.location} />
                            <DataField label="Website" value={detail.enrichment?.website} isLink />
                            <DataField
                              label="Staff count"
                              value={
                                detail.enrichment?.staffCount != null
                                  ? String(detail.enrichment.staffCount)
                                  : null
                              }
                            />
                            <DataField
                              label="Facilities"
                              value={
                                detail.enrichment?.facilitiesCount != null
                                  ? String(detail.enrichment.facilitiesCount)
                                  : null
                              }
                            />
                            <DataField label="Annual revenue" value={detail.enrichment?.annualRevenue} />
                          </div>
                        </section>

                        {/* Targeted Job Titles */}
                        <section>
                          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                            Job Titles to Target
                            {detail.enrichment?.practiceSize && (
                              <span className="ml-2 font-normal normal-case text-muted-foreground">
                                ({detail.enrichment.practiceSize === "solo"
                                  ? "solo / small, 1–5 providers"
                                  : "mid-size, 6–25 providers"})
                              </span>
                            )}
                          </h3>
                          <ul className="space-y-1">
                            {detail.targetedTitles.map((t) => (
                              <li key={t} className="flex items-start gap-2 text-sm">
                                <span className="mt-0.5 text-emerald-500">•</span>
                                <span>{t}</span>
                              </li>
                            ))}
                          </ul>
                        </section>

                        {/* Lead Contacts */}
                        <section>
                          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                            Lead Contacts
                            <span className="ml-2 font-normal normal-case text-muted-foreground">
                              ({detail.leads.length} found)
                            </span>
                          </h3>
                          {detail.leads.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                              No contacts found in Clay enrichment.
                            </p>
                          ) : (
                            <div className="space-y-3">
                              {detail.leads.map((lead) => (
                                <div
                                  key={lead.id}
                                  className="rounded-lg border border-border/30 bg-white/70 px-3 py-2.5 text-sm"
                                >
                                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                    {lead.name && (
                                      <span className="font-medium">{lead.name}</span>
                                    )}
                                    {lead.title && (
                                      <span className="text-muted-foreground">· {lead.title}</span>
                                    )}
                                  </div>
                                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                                    {lead.email && (
                                      <a
                                        href={`mailto:${lead.email}`}
                                        className="flex items-center gap-1 text-amber-700 hover:underline"
                                      >
                                        ✉ {lead.email}
                                      </a>
                                    )}
                                    {lead.phone && (
                                      <span className="text-muted-foreground">
                                        📞 {lead.phone}
                                      </span>
                                    )}
                                    {lead.contactUrl && (
                                      <a
                                        href={lead.contactUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="flex items-center gap-1 text-blue-600 hover:underline"
                                      >
                                        LinkedIn ↗
                                      </a>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </section>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Could not load enrichment details.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DataField({
  label,
  value,
  isLink,
}: {
  label: string;
  value: string | null | undefined;
  isLink?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">
        {value ? (
          isLink ? (
            <a
              href={value.startsWith("http") ? value : `https://${value}`}
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 hover:underline"
            >
              {value}
            </a>
          ) : (
            value
          )
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </dd>
    </div>
  );
}
