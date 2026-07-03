"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CloseEmail { email: string; type: string }
interface ClosePhone { phone: string; type: string }
interface CloseUrl   { url: string; type: string }

interface CloseContact {
  id: string;
  name: string;
  title?: string;
  emails: CloseEmail[];
  phones: ClosePhone[];
  urls: CloseUrl[];
}

interface CloseLead {
  id: string;
  name: string;
  status_id: string;
  status_label: string;
  url?: string;
  description?: string;
  contacts: CloseContact[];
  date_updated: string;
}

interface CloseActivity {
  id: string;
  _type: string;
  note?: string;
  activity_at?: string;
  date_created: string;
  user_id?: string;
  duration?: number;
  direction?: string;
}

interface CloseOpportunity {
  id: string;
  lead_id: string;
  status_label: string;
  status_type: string;
  note?: string;
  value?: number;
  value_currency?: string;
  date_created: string;
}

interface CloseTask {
  id: string;
  lead_id: string;
  text?: string;
  is_complete: boolean;
  due_date?: string;
  date_created: string;
}

interface CloseStatus {
  id: string;
  label: string;
  type: string;
}

interface CloseListResponse<T> {
  data: T[];
  has_more: boolean;
  total_results?: number;
}

type View = "leads" | "detail";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return iso; }
}

function fmtMoney(cents: number | undefined, currency = "USD"): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);
}

function statusColor(type: string): string {
  if (type === "won")  return "bg-green-100 text-green-800";
  if (type === "lost") return "bg-red-100 text-red-800";
  return "bg-amber-100 text-amber-800";
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function CloseCrmTab() {
  const [view, setView]               = useState<View>("leads");
  const [leads, setLeads]             = useState<CloseLead[]>([]);
  const [total, setTotal]             = useState(0);
  const [hasMore, setHasMore]         = useState(false);
  const [skip, setSkip]               = useState(0);
  const [search, setSearch]           = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);

  const [selectedLead, setSelectedLead] = useState<CloseLead | null>(null);
  const [statuses, setStatuses]         = useState<CloseStatus[]>([]);
  const [activities, setActivities]     = useState<CloseActivity[]>([]);
  const [opps, setOpps]                 = useState<CloseOpportunity[]>([]);
  const [tasks, setTasks]               = useState<CloseTask[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const [showNewLead, setShowNewLead]     = useState(false);
  const [showNewContact, setShowNewContact] = useState(false);
  const [showNewNote, setShowNewNote]     = useState(false);
  const [showNewOpp, setShowNewOpp]       = useState(false);
  const [showNewTask, setShowNewTask]     = useState(false);
  const [editingLead, setEditingLead]     = useState(false);

  const [saving, setSaving]   = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const PAGE = 25;

  // ── Fetch leads list ──────────────────────────────────────────────────────

  const fetchLeads = useCallback(async (q: string, s: number) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ _limit: String(PAGE), _skip: String(s) });
      if (q) qs.set("query", q);
      const res = await fetch(`/api/crm/close/leads?${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as CloseListResponse<CloseLead>;
      setLeads(json.data);
      setTotal(json.total_results ?? json.data.length);
      setHasMore(json.has_more);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load leads");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchLeads(search, skip); }, [fetchLeads, search, skip]);

  // ── Fetch statuses ────────────────────────────────────────────────────────

  useEffect(() => {
    fetch("/api/crm/close/statuses", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: CloseListResponse<CloseStatus>) => setStatuses(d.data ?? []))
      .catch(() => {/* non-critical */});
  }, []);

  // ── Open lead detail ──────────────────────────────────────────────────────

  async function openLead(lead: CloseLead) {
    setSelectedLead(lead);
    setView("detail");
    setDetailLoading(true);
    setActivities([]); setOpps([]); setTasks([]);
    setEditingLead(false);
    setShowNewContact(false); setShowNewNote(false);
    setShowNewOpp(false); setShowNewTask(false);
    setSaveMsg(null);
    try {
      const [actRes, oppRes, taskRes] = await Promise.all([
        fetch(`/api/crm/close/activities?lead_id=${lead.id}&_limit=20`, { cache: "no-store" }),
        fetch(`/api/crm/close/opportunities?lead_id=${lead.id}`, { cache: "no-store" }),
        fetch(`/api/crm/close/tasks?lead_id=${lead.id}`, { cache: "no-store" }),
      ]);
      const [actJson, oppJson, taskJson] = await Promise.all([
        actRes.json() as Promise<CloseListResponse<CloseActivity>>,
        oppRes.json() as Promise<CloseListResponse<CloseOpportunity>>,
        taskRes.json() as Promise<CloseListResponse<CloseTask>>,
      ]);
      setActivities(actJson.data ?? []);
      setOpps(oppJson.data ?? []);
      setTasks(taskJson.data ?? []);
    } catch {/* show what we have */}
    finally { setDetailLoading(false); }
  }

  function backToLeads() {
    setView("leads");
    setSelectedLead(null);
    void fetchLeads(search, skip);
  }

  // ── CRUD helpers ──────────────────────────────────────────────────────────

  async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json() as T & { error?: string };
    if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
    return json;
  }

  function showSave(msg: string) {
    setSaveMsg(msg);
    setTimeout(() => setSaveMsg(null), 3000);
  }

  // ── Leads view ────────────────────────────────────────────────────────────

  const searchRef = useRef<ReturnType<typeof setTimeout>>();
  function onSearchChange(v: string) {
    setSearchInput(v);
    clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => { setSearch(v); setSkip(0); }, 400);
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 rounded-xl border border-blue-900/15 bg-blue-50/40 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold text-foreground">
            Close CRM
            {total > 0 && (
              <span className="ml-2 inline-flex items-center rounded-full bg-blue-200 px-2 py-0.5 text-xs font-medium text-blue-900">
                {total} leads
              </span>
            )}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Your Close.com workspace — browse, create, and manage leads, contacts, activities, opportunities, and tasks.
          </p>
        </div>
      </div>

      {/* Leads list view */}
      {view === "leads" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search leads…"
              className="flex-1 min-w-48 rounded-lg border border-border/40 bg-white/70 px-3 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30"
            />
            <button
              onClick={() => setShowNewLead(true)}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 transition"
            >
              + New Lead
            </button>
          </div>

          {/* New lead inline form */}
          {showNewLead && (
            <NewLeadForm
              statuses={statuses}
              onClose={() => setShowNewLead(false)}
              onSave={async (body) => {
                setSaving(true);
                try {
                  await api("/api/crm/close/leads", "POST", body);
                  setShowNewLead(false);
                  void fetchLeads(search, skip);
                } catch (e) {
                  alert(e instanceof Error ? e.message : "Failed");
                } finally { setSaving(false); }
              }}
              saving={saving}
            />
          )}

          {error && <p className="text-sm text-red-600">Error: {error}</p>}

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading leads…</p>
          ) : leads.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/40 p-8 text-center">
              <p className="text-sm text-muted-foreground">No leads found. Create your first one above.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {leads.map((lead) => (
                <button
                  key={lead.id}
                  onClick={() => openLead(lead)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-border/30 bg-white/60 px-4 py-3 text-left transition hover:border-blue-300 hover:bg-blue-50/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-sm">{lead.name}</p>
                    {lead.url && (
                      <p className="truncate text-xs text-muted-foreground">{lead.url}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {lead.contacts.length} contact{lead.contacts.length !== 1 ? "s" : ""}
                    </span>
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                      {lead.status_label}
                    </span>
                    <span className="text-muted-foreground/50 text-xs">›</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Pagination */}
          {(skip > 0 || hasMore) && (
            <div className="flex items-center justify-center gap-2 pt-1">
              <button
                disabled={skip === 0}
                onClick={() => setSkip(Math.max(0, skip - PAGE))}
                className="rounded-lg border border-border/40 px-3 py-1 text-xs text-muted-foreground disabled:opacity-30 hover:text-foreground transition"
              >
                ← Prev
              </button>
              <span className="text-xs text-muted-foreground">
                {skip + 1}–{Math.min(skip + PAGE, total)} of {total}
              </span>
              <button
                disabled={!hasMore}
                onClick={() => setSkip(skip + PAGE)}
                className="rounded-lg border border-border/40 px-3 py-1 text-xs text-muted-foreground disabled:opacity-30 hover:text-foreground transition"
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Lead detail view */}
      {view === "detail" && selectedLead && (
        <LeadDetail
          lead={selectedLead}
          statuses={statuses}
          activities={activities}
          opps={opps}
          tasks={tasks}
          detailLoading={detailLoading}
          saving={saving}
          saveMsg={saveMsg}
          editingLead={editingLead}
          showNewContact={showNewContact}
          showNewNote={showNewNote}
          showNewOpp={showNewOpp}
          showNewTask={showNewTask}
          onBack={backToLeads}
          onEditLead={() => setEditingLead(true)}
          onCancelEdit={() => setEditingLead(false)}
          onSaveLead={async (body) => {
            setSaving(true);
            try {
              const updated = await api<CloseLead>(`/api/crm/close/leads/${selectedLead.id}`, "PUT", body);
              setSelectedLead(updated);
              setEditingLead(false);
              showSave("Lead updated");
            } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
            finally { setSaving(false); }
          }}
          onDeleteLead={async () => {
            if (!confirm(`Delete lead "${selectedLead.name}"? This cannot be undone.`)) return;
            setSaving(true);
            try {
              await api(`/api/crm/close/leads/${selectedLead.id}`, "DELETE");
              backToLeads();
            } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
            finally { setSaving(false); }
          }}
          onToggleNewContact={() => setShowNewContact((v) => !v)}
          onSaveContact={async (body) => {
            setSaving(true);
            try {
              await api("/api/crm/close/contacts", "POST", { ...body, lead_id: selectedLead.id });
              // refresh lead to get updated contacts list
              const updated = await api<CloseLead>(`/api/crm/close/leads/${selectedLead.id}`, "GET");
              setSelectedLead(updated);
              setShowNewContact(false);
              showSave("Contact added");
            } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
            finally { setSaving(false); }
          }}
          onDeleteContact={async (contactId) => {
            if (!confirm("Remove this contact?")) return;
            try {
              await api(`/api/crm/close/contacts/${contactId}`, "DELETE");
              const updated = await api<CloseLead>(`/api/crm/close/leads/${selectedLead.id}`, "GET");
              setSelectedLead(updated);
              showSave("Contact removed");
            } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
          }}
          onToggleNewNote={() => setShowNewNote((v) => !v)}
          onSaveNote={async (note) => {
            setSaving(true);
            try {
              const act = await api<CloseActivity>("/api/crm/close/activities", "POST", {
                _type: "Note", lead_id: selectedLead.id, note,
              });
              setActivities((prev) => [act, ...prev]);
              setShowNewNote(false);
              showSave("Note logged");
            } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
            finally { setSaving(false); }
          }}
          onToggleNewOpp={() => setShowNewOpp((v) => !v)}
          onSaveOpp={async (body) => {
            setSaving(true);
            try {
              const opp = await api<CloseOpportunity>("/api/crm/close/opportunities", "POST", {
                ...body, lead_id: selectedLead.id,
              });
              setOpps((prev) => [opp, ...prev]);
              setShowNewOpp(false);
              showSave("Opportunity created");
            } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
            finally { setSaving(false); }
          }}
          onUpdateOpp={async (id, body) => {
            try {
              const updated = await api<CloseOpportunity>(`/api/crm/close/opportunities/${id}`, "PUT", body);
              setOpps((prev) => prev.map((o) => o.id === id ? updated : o));
              showSave("Opportunity updated");
            } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
          }}
          onDeleteOpp={async (id) => {
            if (!confirm("Delete this opportunity?")) return;
            try {
              await api(`/api/crm/close/opportunities/${id}`, "DELETE");
              setOpps((prev) => prev.filter((o) => o.id !== id));
              showSave("Opportunity deleted");
            } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
          }}
          onToggleNewTask={() => setShowNewTask((v) => !v)}
          onSaveTask={async (body) => {
            setSaving(true);
            try {
              const task = await api<CloseTask>("/api/crm/close/tasks", "POST", {
                ...body, lead_id: selectedLead.id, _type: "lead",
              });
              setTasks((prev) => [task, ...prev]);
              setShowNewTask(false);
              showSave("Task created");
            } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
            finally { setSaving(false); }
          }}
          onCompleteTask={async (id, done) => {
            try {
              const updated = await api<CloseTask>(`/api/crm/close/tasks/${id}`, "PUT", { is_complete: done });
              setTasks((prev) => prev.map((t) => t.id === id ? updated : t));
            } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
          }}
          onDeleteTask={async (id) => {
            try {
              await api(`/api/crm/close/tasks/${id}`, "DELETE");
              setTasks((prev) => prev.filter((t) => t.id !== id));
            } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
          }}
        />
      )}
    </div>
  );
}

// ─── New Lead Form ────────────────────────────────────────────────────────────

function NewLeadForm({
  statuses, onClose, onSave, saving,
}: {
  statuses: CloseStatus[];
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => Promise<void>;
  saving: boolean;
}) {
  const [name, setName]         = useState("");
  const [url, setUrl]           = useState("");
  const [desc, setDesc]         = useState("");
  const [statusId, setStatusId] = useState(statuses[0]?.id ?? "");

  return (
    <div className="rounded-lg border border-blue-200/60 bg-blue-50/30 p-4 space-y-3">
      <p className="text-xs font-semibold text-blue-800 uppercase tracking-wide">New Lead</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Company name *"
          className="rounded-lg border border-border/40 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-400" />
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Website (optional)"
          className="rounded-lg border border-border/40 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-400" />
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description (optional)"
          rows={2}
          className="sm:col-span-2 rounded-lg border border-border/40 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-400 resize-none" />
        {statuses.length > 0 && (
          <select value={statusId} onChange={(e) => setStatusId(e.target.value)}
            className="rounded-lg border border-border/40 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-400">
            {statuses.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        )}
      </div>
      <div className="flex gap-2">
        <button disabled={!name.trim() || saving}
          onClick={() => onSave({ name: name.trim(), url: url.trim() || undefined, description: desc.trim() || undefined, status_id: statusId || undefined })}
          className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40 transition">
          {saving ? "Saving…" : "Create lead"}
        </button>
        <button onClick={onClose} className="rounded-lg border border-border/40 px-3 py-1 text-xs text-muted-foreground hover:text-foreground transition">Cancel</button>
      </div>
    </div>
  );
}

// ─── Lead Detail ──────────────────────────────────────────────────────────────

function LeadDetail({
  lead, statuses, activities, opps, tasks,
  detailLoading, saving, saveMsg, editingLead,
  showNewContact, showNewNote, showNewOpp, showNewTask,
  onBack, onEditLead, onCancelEdit, onSaveLead, onDeleteLead,
  onToggleNewContact, onSaveContact, onDeleteContact,
  onToggleNewNote, onSaveNote,
  onToggleNewOpp, onSaveOpp, onUpdateOpp, onDeleteOpp,
  onToggleNewTask, onSaveTask, onCompleteTask, onDeleteTask,
}: {
  lead: CloseLead;
  statuses: CloseStatus[];
  activities: CloseActivity[];
  opps: CloseOpportunity[];
  tasks: CloseTask[];
  detailLoading: boolean;
  saving: boolean;
  saveMsg: string | null;
  editingLead: boolean;
  showNewContact: boolean;
  showNewNote: boolean;
  showNewOpp: boolean;
  showNewTask: boolean;
  onBack: () => void;
  onEditLead: () => void;
  onCancelEdit: () => void;
  onSaveLead: (body: Record<string, unknown>) => Promise<void>;
  onDeleteLead: () => Promise<void>;
  onToggleNewContact: () => void;
  onSaveContact: (body: Record<string, unknown>) => Promise<void>;
  onDeleteContact: (id: string) => Promise<void>;
  onToggleNewNote: () => void;
  onSaveNote: (note: string) => Promise<void>;
  onToggleNewOpp: () => void;
  onSaveOpp: (body: Record<string, unknown>) => Promise<void>;
  onUpdateOpp: (id: string, body: Record<string, unknown>) => Promise<void>;
  onDeleteOpp: (id: string) => Promise<void>;
  onToggleNewTask: () => void;
  onSaveTask: (body: Record<string, unknown>) => Promise<void>;
  onCompleteTask: (id: string, done: boolean) => Promise<void>;
  onDeleteTask: (id: string) => Promise<void>;
}) {
  const [editName, setEditName]     = useState(lead.name);
  const [editUrl, setEditUrl]       = useState(lead.url ?? "");
  const [editDesc, setEditDesc]     = useState(lead.description ?? "");
  const [editStatus, setEditStatus] = useState(lead.status_id);

  // Reset edit fields when lead changes
  useEffect(() => {
    setEditName(lead.name);
    setEditUrl(lead.url ?? "");
    setEditDesc(lead.description ?? "");
    setEditStatus(lead.status_id);
  }, [lead]);

  const sectionCls = "rounded-lg border border-border/20 bg-white/60 p-4 space-y-3";
  const hCls = "text-xs font-semibold uppercase tracking-wide text-blue-700 flex items-center justify-between";

  return (
    <div className="space-y-4">
      {/* Back + title row */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onBack} className="rounded-lg border border-border/40 px-3 py-1 text-xs text-muted-foreground hover:text-foreground transition">
          ← Back
        </button>
        {!editingLead ? (
          <>
            <h3 className="flex-1 font-semibold">{lead.name}</h3>
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">{lead.status_label}</span>
            {saveMsg && <span className="text-xs text-green-600">{saveMsg}</span>}
            <button onClick={onEditLead} className="rounded-lg border border-blue-300/60 px-3 py-1 text-xs text-blue-700 hover:bg-blue-50 transition">Edit</button>
            <button onClick={onDeleteLead} className="rounded-lg border border-red-300/60 px-3 py-1 text-xs text-red-600 hover:bg-red-50 transition">Delete</button>
          </>
        ) : (
          <>
            <input value={editName} onChange={(e) => setEditName(e.target.value)}
              className="flex-1 rounded-lg border border-blue-300 bg-white px-3 py-1 text-sm font-semibold outline-none" />
            {statuses.length > 0 && (
              <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}
                className="rounded-lg border border-border/40 bg-white px-2 py-1 text-xs outline-none">
                {statuses.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            )}
            <button disabled={saving} onClick={() => onSaveLead({ name: editName, url: editUrl || undefined, description: editDesc || undefined, status_id: editStatus })}
              className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40 transition">
              {saving ? "Saving…" : "Save"}
            </button>
            <button onClick={onCancelEdit} className="rounded-lg border border-border/40 px-3 py-1 text-xs text-muted-foreground hover:text-foreground transition">Cancel</button>
          </>
        )}
      </div>

      {editingLead && (
        <div className="grid gap-2 sm:grid-cols-2">
          <input value={editUrl} onChange={(e) => setEditUrl(e.target.value)} placeholder="Website URL"
            className="rounded-lg border border-border/40 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-400" />
          <textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="Description" rows={2}
            className="sm:col-span-1 rounded-lg border border-border/40 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-400 resize-none" />
        </div>
      )}

      {!editingLead && (lead.url || lead.description) && (
        <div className="text-sm text-muted-foreground space-y-0.5">
          {lead.url && <a href={lead.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline block truncate">{lead.url}</a>}
          {lead.description && <p className="text-xs">{lead.description}</p>}
        </div>
      )}

      {detailLoading && <p className="text-sm text-muted-foreground">Loading details…</p>}

      {/* Contacts */}
      <div className={sectionCls}>
        <div className={hCls}>
          <span>Contacts ({lead.contacts.length})</span>
          <button onClick={onToggleNewContact} className="text-xs font-normal normal-case text-blue-600 hover:underline">
            {showNewContact ? "Cancel" : "+ Add contact"}
          </button>
        </div>
        {showNewContact && (
          <NewContactForm saving={saving} onSave={onSaveContact} onClose={onToggleNewContact} />
        )}
        {lead.contacts.length === 0 && !showNewContact && (
          <p className="text-xs text-muted-foreground">No contacts yet.</p>
        )}
        {lead.contacts.map((c) => (
          <div key={c.id} className="flex items-start justify-between gap-2 rounded-lg border border-border/20 bg-white/70 px-3 py-2 text-sm">
            <div className="min-w-0">
              <p className="font-medium truncate">{c.name}{c.title ? <span className="ml-1 text-muted-foreground font-normal">· {c.title}</span> : null}</p>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-xs">
                {c.emails.map((e, i) => <a key={i} href={`mailto:${e.email}`} className="text-amber-700 hover:underline">✉ {e.email}</a>)}
                {c.phones.map((p, i) => <span key={i} className="text-muted-foreground">📞 {p.phone}</span>)}
                {c.urls.map((u, i) => <a key={i} href={u.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">LinkedIn ↗</a>)}
              </div>
            </div>
            <button onClick={() => onDeleteContact(c.id)} className="shrink-0 text-xs text-red-400 hover:text-red-600">✕</button>
          </div>
        ))}
      </div>

      {/* Activities */}
      <div className={sectionCls}>
        <div className={hCls}>
          <span>Activities</span>
          <button onClick={onToggleNewNote} className="text-xs font-normal normal-case text-blue-600 hover:underline">
            {showNewNote ? "Cancel" : "+ Log note"}
          </button>
        </div>
        {showNewNote && (
          <NoteForm saving={saving} onSave={onSaveNote} onClose={onToggleNewNote} />
        )}
        {activities.length === 0 && !detailLoading && (
          <p className="text-xs text-muted-foreground">No activities yet.</p>
        )}
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {activities.map((a) => (
            <div key={a.id} className="flex gap-2 text-xs">
              <span className="shrink-0 text-muted-foreground/60 w-20">{fmtDate(a.activity_at ?? a.date_created)}</span>
              <span className={cn("shrink-0 rounded px-1 font-medium",
                a._type === "Note" ? "bg-amber-50 text-amber-700" :
                a._type === "Call" ? "bg-green-50 text-green-700" :
                a._type === "Email" ? "bg-blue-50 text-blue-700" : "bg-gray-50 text-gray-600"
              )}>{a._type}</span>
              <span className="text-foreground/80 line-clamp-2">{a.note ?? (a._type === "Call" ? `${a.direction ?? ""} call · ${a.duration ? `${a.duration}s` : ""}` : "")}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Opportunities */}
      <div className={sectionCls}>
        <div className={hCls}>
          <span>Opportunities ({opps.length})</span>
          <button onClick={onToggleNewOpp} className="text-xs font-normal normal-case text-blue-600 hover:underline">
            {showNewOpp ? "Cancel" : "+ New"}
          </button>
        </div>
        {showNewOpp && (
          <OppForm saving={saving} onSave={onSaveOpp} onClose={onToggleNewOpp} />
        )}
        {opps.length === 0 && !detailLoading && !showNewOpp && (
          <p className="text-xs text-muted-foreground">No opportunities yet.</p>
        )}
        {opps.map((o) => (
          <div key={o.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/20 bg-white/70 px-3 py-2 text-sm">
            <div>
              <div className="flex items-center gap-2">
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusColor(o.status_type))}>{o.status_label}</span>
                {o.value != null && <span className="text-xs text-muted-foreground">{fmtMoney(o.value, o.value_currency)}</span>}
              </div>
              {o.note && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{o.note}</p>}
            </div>
            <div className="flex gap-1">
              {o.status_type === "active" && (
                <button onClick={() => onUpdateOpp(o.id, { status_type: "won" })}
                  className="rounded px-2 py-0.5 text-xs bg-green-50 text-green-700 hover:bg-green-100 transition">Won</button>
              )}
              <button onClick={() => onDeleteOpp(o.id)} className="text-xs text-red-400 hover:text-red-600">✕</button>
            </div>
          </div>
        ))}
      </div>

      {/* Tasks */}
      <div className={sectionCls}>
        <div className={hCls}>
          <span>Tasks ({tasks.filter((t) => !t.is_complete).length} open)</span>
          <button onClick={onToggleNewTask} className="text-xs font-normal normal-case text-blue-600 hover:underline">
            {showNewTask ? "Cancel" : "+ New task"}
          </button>
        </div>
        {showNewTask && (
          <TaskForm saving={saving} onSave={onSaveTask} onClose={onToggleNewTask} />
        )}
        {tasks.length === 0 && !detailLoading && !showNewTask && (
          <p className="text-xs text-muted-foreground">No tasks yet.</p>
        )}
        {tasks.map((t) => (
          <div key={t.id} className={cn("flex items-start justify-between gap-2 rounded-lg border px-3 py-2 text-sm",
            t.is_complete ? "border-border/10 bg-white/30 opacity-50" : "border-border/20 bg-white/70"
          )}>
            <div className="flex items-start gap-2">
              <input type="checkbox" checked={t.is_complete}
                onChange={(e) => onCompleteTask(t.id, e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300 accent-blue-600" />
              <div>
                <p className={cn("text-sm", t.is_complete && "line-through")}>{t.text ?? "Task"}</p>
                {t.due_date && <p className="text-xs text-muted-foreground">Due {t.due_date}</p>}
              </div>
            </div>
            <button onClick={() => onDeleteTask(t.id)} className="shrink-0 text-xs text-red-400 hover:text-red-600">✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Inline Forms ─────────────────────────────────────────────────────────────

function NewContactForm({ saving, onSave, onClose }: {
  saving: boolean;
  onSave: (body: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName]     = useState("");
  const [title, setTitle]   = useState("");
  const [email, setEmail]   = useState("");
  const [phone, setPhone]   = useState("");
  const [linkedin, setLinkedin] = useState("");

  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50/20 p-3 space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name *"
          className="rounded-lg border border-border/40 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-400" />
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Job title"
          className="rounded-lg border border-border/40 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-400" />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email"
          className="rounded-lg border border-border/40 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-400" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone"
          className="rounded-lg border border-border/40 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-400" />
        <input value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="LinkedIn URL"
          className="sm:col-span-2 rounded-lg border border-border/40 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-400" />
      </div>
      <div className="flex gap-2">
        <button disabled={!name.trim() || saving} onClick={() => onSave({
          name: name.trim(), title: title.trim() || undefined,
          emails: email.trim() ? [{ email: email.trim(), type: "office" }] : [],
          phones: phone.trim() ? [{ phone: phone.trim(), type: "office" }] : [],
          urls: linkedin.trim() ? [{ url: linkedin.trim(), type: "linkedin" }] : [],
        })} className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40 transition">
          {saving ? "Saving…" : "Add contact"}
        </button>
        <button onClick={onClose} className="rounded-lg border border-border/40 px-3 py-1 text-xs text-muted-foreground hover:text-foreground transition">Cancel</button>
      </div>
    </div>
  );
}

function NoteForm({ saving, onSave, onClose }: { saving: boolean; onSave: (n: string) => Promise<void>; onClose: () => void }) {
  const [note, setNote] = useState("");
  return (
    <div className="space-y-2">
      <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Write a note…" rows={3}
        className="w-full rounded-lg border border-border/40 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-400 resize-none" />
      <div className="flex gap-2">
        <button disabled={!note.trim() || saving} onClick={() => onSave(note.trim())}
          className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40 transition">
          {saving ? "Saving…" : "Log note"}
        </button>
        <button onClick={onClose} className="rounded-lg border border-border/40 px-3 py-1 text-xs text-muted-foreground hover:text-foreground transition">Cancel</button>
      </div>
    </div>
  );
}

function OppForm({ saving, onSave, onClose }: { saving: boolean; onSave: (b: Record<string, unknown>) => Promise<void>; onClose: () => void }) {
  const [note, setNote]   = useState("");
  const [value, setValue] = useState("");
  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50/20 p-3 space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Deal note"
          className="sm:col-span-2 rounded-lg border border-border/40 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-400" />
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Value in $ (e.g. 5000)"
          type="number" min="0"
          className="rounded-lg border border-border/40 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-400" />
      </div>
      <div className="flex gap-2">
        <button disabled={saving} onClick={() => onSave({
          note: note.trim() || undefined,
          value: value ? Math.round(Number(value) * 100) : undefined,
          value_currency: "USD", value_period: "one_time",
        })} className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40 transition">
          {saving ? "Saving…" : "Create opportunity"}
        </button>
        <button onClick={onClose} className="rounded-lg border border-border/40 px-3 py-1 text-xs text-muted-foreground hover:text-foreground transition">Cancel</button>
      </div>
    </div>
  );
}

function TaskForm({ saving, onSave, onClose }: { saving: boolean; onSave: (b: Record<string, unknown>) => Promise<void>; onClose: () => void }) {
  const [text, setText]     = useState("");
  const [dueDate, setDueDate] = useState("");
  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50/20 p-3 space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Task description *"
          className="rounded-lg border border-border/40 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-400" />
        <input value={dueDate} onChange={(e) => setDueDate(e.target.value)} type="date"
          className="rounded-lg border border-border/40 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-400" />
      </div>
      <div className="flex gap-2">
        <button disabled={!text.trim() || saving} onClick={() => onSave({ text: text.trim(), due_date: dueDate || undefined })}
          className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40 transition">
          {saving ? "Saving…" : "Create task"}
        </button>
        <button onClick={onClose} className="rounded-lg border border-border/40 px-3 py-1 text-xs text-muted-foreground hover:text-foreground transition">Cancel</button>
      </div>
    </div>
  );
}
