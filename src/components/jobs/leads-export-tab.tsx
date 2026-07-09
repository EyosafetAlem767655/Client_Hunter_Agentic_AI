"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const TOKEN_KEY = "talentbridge_admin_token";
const PUSH_CHUNK = 40; // must match MAX_PER_CALL on the server

interface EnrichmentMeta {
  companyName: string | null;
  website: string | null;
  location: string | null;
  staffCount: number | null;
  practiceSize: string | null;
  closeLeadId: string | null;
  closeLeadStatus: string | null;
}

interface LeadRow {
  postingId: number;
  title: string;
  company: string;
  url: string;
  score: number;
  contactCount: number;
  enrichment: EnrichmentMeta;
}

function getToken(): string {
  return typeof window !== "undefined" ? (sessionStorage.getItem(TOKEN_KEY) ?? "") : "";
}

/** Fetch an authenticated file and save it to disk. */
async function downloadFile(url: string, token: string): Promise<void> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Export failed (${res.status}) ${msg.slice(0, 120)}`);
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = match?.[1] ?? "export";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export function LeadsExportTab() {
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tokenDraft, setTokenDraft] = useState("");
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => setHasToken(!!getToken()), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/enrichment?pageSize=500");
      const data = (await res.json()) as { items?: LeadRow[]; error?: string };
      if (data.error) setError(data.error);
      else setRows(data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load leads");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function saveToken() {
    if (!tokenDraft.trim()) return;
    sessionStorage.setItem(TOKEN_KEY, tokenDraft.trim());
    setTokenDraft("");
    setHasToken(true);
  }

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.postingId))));
  }

  const ids = Array.from(selected);
  const idsParam = ids.length > 0 ? `&ids=${ids.join(",")}` : "";

  async function exportLeads(format: "csv" | "xlsx") {
    const token = getToken();
    if (!token) { setError("Enter your ADMIN_TOKEN first."); return; }
    setBusy(format); setError(null); setStatus(null);
    try {
      await downloadFile(`/api/export/close-leads?format=${format}${idsParam}`, token);
      setStatus(
        `Downloaded ${format.toUpperCase()} — ${ids.length > 0 ? `${ids.length} selected lead(s)` : "all enriched leads"}. Upload it in Close → Import.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally { setBusy(null); }
  }

  async function pushToClose() {
    const token = getToken();
    if (!token) { setError("Enter your ADMIN_TOKEN first."); return; }
    if (ids.length === 0) { setError("Select at least one lead to push."); return; }
    setBusy("push"); setError(null); setStatus(null);

    let created = 0, updated = 0, failed = 0;
    try {
      for (let i = 0; i < ids.length; i += PUSH_CHUNK) {
        const chunk = ids.slice(i, i + PUSH_CHUNK);
        setStatus(`Pushing ${i + 1}–${Math.min(i + chunk.length, ids.length)} of ${ids.length}…`);
        const res = await fetch("/api/crm/close/push-bulk", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ postingIds: chunk }),
        });
        const data = (await res.json()) as {
          created?: number; updated?: number; failed?: number; error?: string;
        };
        if (data.error) throw new Error(data.error);
        created += data.created ?? 0;
        updated += data.updated ?? 0;
        failed += data.failed ?? 0;
      }
      setStatus(`Pushed to Close — ${created} created, ${updated} updated${failed ? `, ${failed} failed` : ""}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk push failed");
    } finally { setBusy(null); }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading enriched leads…</p>;

  return (
    <div className="space-y-4">
      {!hasToken && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50/60 p-3">
          <span className="text-sm text-amber-900">Admin token required to export or push:</span>
          <input
            type="password"
            value={tokenDraft}
            onChange={(e) => setTokenDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveToken()}
            placeholder="ADMIN_TOKEN"
            className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
          />
          <button onClick={saveToken} className="rounded-lg bg-amber-700 px-3 py-1.5 text-sm text-white hover:bg-amber-800">
            Save
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {rows.length} enriched lead{rows.length === 1 ? "" : "s"} ·{" "}
          <span className="font-medium text-foreground">{ids.length} selected</span>
          {ids.length === 0 && " (exports include all)"}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void exportLeads("csv")}
            disabled={busy !== null}
            className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 transition"
          >
            {busy === "csv" ? "Preparing…" : "⬇ Close CSV"}
          </button>
          <button
            onClick={() => void exportLeads("xlsx")}
            disabled={busy !== null}
            className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 transition"
          >
            {busy === "xlsx" ? "Preparing…" : "⬇ Close Excel"}
          </button>
          <button
            onClick={() => void pushToClose()}
            disabled={busy !== null || ids.length === 0}
            className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-800 hover:bg-blue-100 disabled:opacity-50 transition"
          >
            {busy === "push" ? "Pushing…" : `⚡ Push ${ids.length || ""} to Close`}
          </button>
        </div>
      </div>

      {status && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{status}</p>}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      <div className="glass-card overflow-x-auto rounded-xl">
        <table className="w-full text-sm">
          <thead className="border-b border-border/50 bg-muted/30 text-left text-muted-foreground">
            <tr>
              <th className="p-3">
                <input
                  type="checkbox"
                  checked={rows.length > 0 && selected.size === rows.length}
                  onChange={toggleAll}
                  aria-label="Select all leads"
                />
              </th>
              <th className="p-3">Company</th>
              <th className="p-3">Job title</th>
              <th className="p-3">Score</th>
              <th className="p-3">Contacts</th>
              <th className="p-3">Website</th>
              <th className="p-3">In Close</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted-foreground">
                  No enriched leads yet — enrich some jobs first.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.postingId} className="border-b border-border/30 hover:bg-accent/20">
                <td className="p-3">
                  <input
                    type="checkbox"
                    checked={selected.has(r.postingId)}
                    onChange={() => toggle(r.postingId)}
                    aria-label={`Select ${r.company}`}
                  />
                </td>
                <td className="p-3 font-medium">{r.enrichment?.companyName ?? r.company}</td>
                <td className="p-3">{r.title}</td>
                <td className="p-3 tabular-nums">{r.score}</td>
                <td className="p-3 tabular-nums">{r.contactCount}</td>
                <td className="p-3">
                  {r.enrichment?.website ? (
                    <a
                      href={`https://${r.enrichment.website.replace(/^https?:\/\//, "")}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-emerald-700 hover:underline"
                    >
                      {r.enrichment.website}
                    </a>
                  ) : "—"}
                </td>
                <td className="p-3">
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-medium",
                    r.enrichment?.closeLeadId
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-muted text-muted-foreground"
                  )}>
                    {r.enrichment?.closeLeadId ? (r.enrichment.closeLeadStatus ?? "Synced") : "Not pushed"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
