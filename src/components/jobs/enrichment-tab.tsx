"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface EnrichmentData {
  companyName: string | null;
  location: string | null;
  website: string | null;
  staffCount: number | null;
  annualRevenue: string | null;
  facilitiesCount: number | null;
  practiceSize: string | null;
  closeLeadId: string | null;
  closeLeadStatus: string | null;
}

interface EnrichedJob {
  postingId: number;
  title: string;
  company: string;
  url: string;
  score: number;
  enrichedAt: string | Date;
  contactCount: number;
  enrichment: EnrichmentData;
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
  enrichment: EnrichmentData | null;
  leads: Lead[];
  targetedTitles: string[];
}

interface Props {
  initialJobId?: string;
}

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

function formatDate(iso: string | Date): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
  } catch { return String(iso); }
}

// ─── CRM Status Badge ─────────────────────────────────────────────────────────

function CrmBadge({ status }: { status: string | null }) {
  if (!status) {
    return (
      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
        Not pushed
      </span>
    );
  }
  const lower = status.toLowerCase();
  const cls = lower.includes("won")
    ? "bg-green-100 text-green-800"
    : lower.includes("lost")
    ? "bg-red-100 text-red-800"
    : lower.includes("trial") || lower.includes("potential")
    ? "bg-amber-100 text-amber-800"
    : "bg-blue-100 text-blue-800";
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", cls)}>
      {status}
    </span>
  );
}

// ─── Contacts Detail (expanded row) ──────────────────────────────────────────

function ContactsDetail({ detail }: { detail: EnrichmentDetail | undefined }) {
  if (!detail) return <p className="text-xs text-muted-foreground">No detail loaded.</p>;
  return (
    <div className="space-y-4">
      {detail.enrichment?.practiceSize && (
        <p className="text-xs text-muted-foreground">
          Practice size: <span className="font-medium">{detail.enrichment.practiceSize === "solo"
            ? "Solo / small (1–5 providers)" : "Mid-size (6–25 providers)"}</span>
        </p>
      )}
      {detail.targetedTitles.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Titles to target
          </p>
          <div className="flex flex-wrap gap-1">
            {detail.targetedTitles.map((t) => (
              <span key={t} className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">{t}</span>
            ))}
          </div>
        </div>
      )}
      {detail.leads.length === 0 ? (
        <p className="text-xs text-muted-foreground">No Clay contacts found.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Lead Contacts ({detail.leads.length})
          </p>
          {detail.leads.map((lead) => (
            <div key={lead.id} className="rounded-lg border border-border/30 bg-white/70 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                {lead.name && <span className="font-medium">{lead.name}</span>}
                {lead.title && <span className="text-muted-foreground">· {lead.title}</span>}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                {lead.email && (
                  <a href={`mailto:${lead.email}`} className="text-amber-700 hover:underline">✉ {lead.email}</a>
                )}
                {lead.phone && <span className="text-muted-foreground">📞 {lead.phone}</span>}
                {lead.contactUrl && (
                  <a href={lead.contactUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">LinkedIn ↗</a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function EnrichmentTab({ initialJobId }: Props) {
  const [jobs, setJobs] = useState<EnrichedJob[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Row expand (contacts)
  const [expandedId, setExpandedId] = useState<number | null>(
    initialJobId ? Number(initialJobId) : null
  );
  const [detailCache, setDetailCache] = useState<Map<number, EnrichmentDetail>>(new Map());
  const [loadingDetail, setLoadingDetail] = useState<number | null>(null);

  // Selection + bulk
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkAction, setBulkAction] = useState<"push" | "update" | "remove" | "">("");
  const [bulkLoading, setBulkLoading] = useState(false);

  // Per-row CRM state
  const [pushingId, setPushingId] = useState<number | null>(null);
  const [pushResults, setPushResults] = useState<Record<number, string>>({});
  const [syncingCrm, setSyncingCrm] = useState(false);

  // ── Data fetch ──────────────────────────────────────────────────────────────

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/enrichment?pageSize=500", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { items: EnrichedJob[]; total: number };
      setJobs(json.items);
      setTotal(json.total);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchJobs(); }, [fetchJobs]);

  // ── Contact lazy-load ───────────────────────────────────────────────────────

  async function toggleExpand(postingId: number) {
    if (expandedId === postingId) { setExpandedId(null); return; }
    setExpandedId(postingId);
    if (!detailCache.has(postingId)) {
      setLoadingDetail(postingId);
      try {
        const res = await fetch(`/api/enrichment/${postingId}`, { cache: "no-store" });
        if (res.ok) {
          const detail = await res.json() as EnrichmentDetail;
          setDetailCache((prev) => new Map(prev).set(postingId, detail));
        }
      } finally { setLoadingDetail(null); }
    }
  }

  // ── Selection helpers ───────────────────────────────────────────────────────

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) =>
      prev.size === jobs.length ? new Set() : new Set(jobs.map((j) => j.postingId))
    );
  }

  // ── CRM actions ─────────────────────────────────────────────────────────────

  async function pushToCrm(postingId: number) {
    setPushingId(postingId);
    setPushResults((prev) => ({ ...prev, [postingId]: "Pushing…" }));
    try {
      const res = await fetch("/api/crm/close/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postingId }),
      });
      const json = await res.json() as { ok?: boolean; action?: string; leadId?: string; contactsCreated?: number; error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      const label = json.action === "updated"
        ? `✓ Updated in CRM · ${json.leadId ?? ""}`
        : `✓ Pushed · ${json.contactsCreated ?? 0} contact(s)`;
      setPushResults((prev) => ({ ...prev, [postingId]: label }));
      setJobs((prev) => prev.map((j) =>
        j.postingId === postingId
          ? { ...j, enrichment: { ...j.enrichment, closeLeadId: json.leadId ?? null, closeLeadStatus: "Active" } }
          : j
      ));
    } catch (e) {
      setPushResults((prev) => ({
        ...prev,
        [postingId]: `Error: ${e instanceof Error ? e.message : "Push failed"}`,
      }));
    } finally { setPushingId(null); }
  }

  async function unlinkFromCrm(postingId: number) {
    if (!confirm("Remove this lead from Close CRM? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/crm/close/unlink/${postingId}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setJobs((prev) => prev.map((j) =>
        j.postingId === postingId
          ? { ...j, enrichment: { ...j.enrichment, closeLeadId: null, closeLeadStatus: null } }
          : j
      ));
      setPushResults((prev) => ({ ...prev, [postingId]: "Unlinked from CRM" }));
    } catch (e) {
      setPushResults((prev) => ({
        ...prev,
        [postingId]: `Error: ${e instanceof Error ? e.message : "Unlink failed"}`,
      }));
    }
  }

  async function syncCrmStatus() {
    setSyncingCrm(true);
    try {
      await fetch("/api/crm/close/sync", { method: "POST" });
      await fetchJobs();
    } finally { setSyncingCrm(false); }
  }

  async function applyBulkAction() {
    if (!bulkAction) return;
    setBulkLoading(true);
    for (const id of Array.from(selectedIds)) {
      if (bulkAction === "push" || bulkAction === "update") {
        await pushToCrm(id);
      } else if (bulkAction === "remove") {
        const job = jobs.find((j) => j.postingId === id);
        if (job?.enrichment.closeLeadId) await unlinkFromCrm(id);
      }
    }
    setBulkLoading(false);
    setSelectedIds(new Set());
    setBulkAction("");
  }

  // ── CSV Export ───────────────────────────────────────────────────────────────

  function exportCsv() {
    const header = [
      "Company", "Job Title", "Location", "Website", "Staff", "Revenue",
      "Practice Size", "Facilities", "CRM Lead ID", "CRM Status",
      "Contact Name", "Title", "Email", "Phone", "LinkedIn",
    ];
    const rows: string[][] = [header];
    for (const job of jobs) {
      const e = job.enrichment;
      const detail = detailCache.get(job.postingId);
      const baseRow = [
        e.companyName ?? job.company, job.title,
        e.location ?? "", e.website ?? "",
        e.staffCount != null ? String(e.staffCount) : "",
        e.annualRevenue ?? "",
        e.practiceSize ?? "",
        e.facilitiesCount != null ? String(e.facilitiesCount) : "",
        e.closeLeadId ?? "",
        e.closeLeadStatus ?? "",
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

  // ─────────────────────────────────────────────────────────────────────────────

  if (loading) return <p className="text-sm text-muted-foreground">Loading enrichment data…</p>;
  if (error) return <p className="text-sm text-red-600">Error: {error}</p>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 rounded-xl border border-emerald-900/15 bg-emerald-50/40 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold text-foreground">
            Enrichment Details
            <span className="ml-2 inline-flex items-center rounded-full bg-emerald-200 px-2 py-0.5 text-xs font-medium text-emerald-900">
              {total} enriched
            </span>
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Select rows to take bulk CRM actions, or use per-row buttons. Click a company name to see contacts.
          </p>
        </div>
        {jobs.length > 0 && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              onClick={syncCrmStatus}
              disabled={syncingCrm}
              className="rounded-lg border border-blue-300/60 bg-white/70 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50 transition"
            >
              {syncingCrm ? "Syncing…" : "Sync CRM Status"}
            </button>
            <button
              onClick={exportCsv}
              className="rounded-lg border border-emerald-300/60 bg-white/70 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-50 transition"
            >
              ↓ Export CSV
            </button>
          </div>
        )}
      </div>

      {/* Bulk action toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2">
          <span className="text-sm font-medium text-blue-900">{selectedIds.size} selected</span>
          <select
            value={bulkAction}
            onChange={(e) => setBulkAction(e.target.value as typeof bulkAction)}
            className="rounded-lg border border-blue-200 bg-white px-2 py-1 text-sm outline-none"
          >
            <option value="">Choose action…</option>
            <option value="push">Push to CRM</option>
            <option value="update">Update in CRM</option>
            <option value="remove">Remove from CRM</option>
          </select>
          <button
            onClick={applyBulkAction}
            disabled={!bulkAction || bulkLoading}
            className="rounded-lg bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 transition"
          >
            {bulkLoading ? "Working…" : "Apply"}
          </button>
          <button
            onClick={() => { setSelectedIds(new Set()); setBulkAction(""); }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}

      {jobs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/40 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No enriched jobs yet. Go to Lead Status and click Enrich on a job.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-emerald-200/60 bg-white/50">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-emerald-200/60 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="w-8 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === jobs.length && jobs.length > 0}
                    onChange={toggleSelectAll}
                    className="h-3.5 w-3.5 rounded border-gray-300 accent-blue-600"
                  />
                </th>
                <th className="px-3 py-2.5">Company</th>
                <th className="px-3 py-2.5">Location</th>
                <th className="px-3 py-2.5">Website</th>
                <th className="px-3 py-2.5 text-right">Staff</th>
                <th className="px-3 py-2.5 text-right">Contacts</th>
                <th className="px-3 py-2.5">CRM Status</th>
                <th className="px-3 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <>
                  <tr
                    key={job.postingId}
                    className={cn(
                      "border-b border-emerald-100/60 transition hover:bg-emerald-50/30",
                      selectedIds.has(job.postingId) && "bg-blue-50/40"
                    )}
                  >
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(job.postingId)}
                        onChange={() => toggleSelect(job.postingId)}
                        className="h-3.5 w-3.5 rounded border-gray-300 accent-blue-600"
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <button
                        onClick={() => toggleExpand(job.postingId)}
                        className="block text-left font-medium hover:underline"
                      >
                        {job.enrichment.companyName ?? job.company}
                      </button>
                      <a
                        href={job.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="block truncate max-w-[200px] text-xs text-muted-foreground hover:underline"
                      >
                        {job.title}
                      </a>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {job.enrichment.location ?? "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      {job.enrichment.website ? (
                        <a
                          href={job.enrichment.website.startsWith("http") ? job.enrichment.website : `https://${job.enrichment.website}`}
                          target="_blank"
                          rel="noreferrer"
                          className="block truncate max-w-[140px] text-xs text-blue-600 hover:underline"
                        >
                          {job.enrichment.website.replace(/^https?:\/\//, "")}
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-xs text-muted-foreground">
                      {job.enrichment.staffCount ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-xs">
                      <button
                        onClick={() => toggleExpand(job.postingId)}
                        className={cn(
                          "font-medium",
                          job.contactCount > 0 ? "text-emerald-700 hover:underline" : "text-muted-foreground"
                        )}
                      >
                        {job.contactCount}
                      </button>
                    </td>
                    <td className="px-3 py-2.5">
                      <CrmBadge status={job.enrichment.closeLeadStatus} />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {/* Push / Update */}
                        <button
                          onClick={() => pushToCrm(job.postingId)}
                          disabled={pushingId === job.postingId}
                          className="rounded px-2 py-1 text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition"
                        >
                          {pushingId === job.postingId
                            ? "…"
                            : job.enrichment.closeLeadId ? "Update" : "Push"}
                        </button>
                        {/* View in Close */}
                        {job.enrichment.closeLeadId && (
                          <a
                            href={`https://app.close.com/lead/${job.enrichment.closeLeadId}/`}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded border border-gray-200 px-2 py-1 text-xs hover:bg-gray-50 transition"
                          >
                            View ↗
                          </a>
                        )}
                        {/* Unlink */}
                        {job.enrichment.closeLeadId && (
                          <button
                            onClick={() => unlinkFromCrm(job.postingId)}
                            className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 transition"
                          >
                            Unlink
                          </button>
                        )}
                        {/* Inline result */}
                        {pushResults[job.postingId] && (
                          <span className={cn(
                            "text-xs",
                            pushResults[job.postingId].startsWith("Error")
                              ? "text-red-600"
                              : pushResults[job.postingId].startsWith("Unlinked")
                              ? "text-gray-500"
                              : "text-blue-700"
                          )}>
                            {pushResults[job.postingId]}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                  {/* Expanded contacts row */}
                  {expandedId === job.postingId && (
                    <tr key={`${job.postingId}-detail`}>
                      <td colSpan={8} className="border-b border-emerald-100/60 bg-emerald-50/20 px-6 py-4">
                        {loadingDetail === job.postingId ? (
                          <p className="text-xs text-muted-foreground">Loading contacts…</p>
                        ) : (
                          <ContactsDetail detail={detailCache.get(job.postingId)} />
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
