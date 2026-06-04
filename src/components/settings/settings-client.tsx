"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Mail,
  Play,
  Sparkles,
  Wand2,
} from "lucide-react";

const TOKEN_KEY = "talentbridge_admin_token";

interface RunResult {
  label: string;
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
  at: number;
}

export function SettingsClient({
  initial,
  maskedEnv,
}: {
  initial: { DRY_RUN: boolean; AGENT_ENABLED: boolean };
  maskedEnv: Record<string, string | boolean>;
}) {
  const [settings, setSettings] = useState(initial);
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(
    null
  );
  const [loading, setLoading] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<RunResult | null>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem(TOKEN_KEY);
    if (saved) setToken(saved);
  }, []);

  function saveToken(value: string) {
    setToken(value);
    if (value) sessionStorage.setItem(TOKEN_KEY, value);
    else sessionStorage.removeItem(TOKEN_KEY);
  }

  function showToast(kind: "ok" | "err", msg: string) {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 4000);
  }

  async function patchSettings(patch: Partial<typeof settings>) {
    if (!token.trim()) {
      showToast("err", "Enter your ADMIN_TOKEN first (from Vercel env vars).");
      return;
    }
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token.trim()}`,
      },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      showToast(
        "err",
        "Failed to update — check ADMIN_TOKEN matches Vercel exactly."
      );
      return;
    }
    setSettings((s) => ({ ...s, ...patch }));
    showToast("ok", "Setting updated");
  }

  async function runManual(path: string, label: string) {
    if (!token.trim()) {
      showToast(
        "err",
        "Unauthorized — enter ADMIN_TOKEN from Vercel → Settings → Environment Variables."
      );
      return;
    }
    setLoading(label);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { Authorization: `Bearer ${token.trim()}` },
      });
      let data: Record<string, unknown> = {};
      try {
        data = await res.json();
      } catch {
        // ignore parse error
      }
      if (!res.ok) {
        const err = (data?.error as string) ?? `HTTP ${res.status}`;
        setLastRun({ label, ok: false, error: err, at: Date.now() });
        showToast("err", `${label} failed: ${err}`);
        return;
      }
      setLastRun({ label, ok: true, data, at: Date.now() });
      showToast("ok", `${label} complete`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Request failed";
      setLastRun({ label, ok: false, error: msg, at: Date.now() });
      showToast("err", msg);
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-6">
      {toast && (
        <div
          className={`fixed right-6 top-20 z-50 flex max-w-md items-center gap-2 rounded-lg border px-4 py-3 shadow-2xl backdrop-blur-md ${
            toast.kind === "ok"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
              : "border-red-500/40 bg-red-500/10 text-red-200"
          }`}
        >
          {toast.kind === "ok" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" />
          )}
          <span className="text-sm">{toast.msg}</span>
        </div>
      )}

      {/* Auth strip */}
      <Card className="glass-card border-primary/20">
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
          <KeyRound className="h-5 w-5 shrink-0 text-primary" />
          <div className="flex-1">
            <div className="text-sm font-medium text-foreground">
              Admin token
            </div>
            <div className="text-xs text-muted-foreground">
              Paste the <code className="rounded bg-muted px-1 font-mono">ADMIN_TOKEN</code> from
              Vercel → Project → Settings → Environment Variables. Stored only in this browser tab.
            </div>
          </div>
          <div className="relative flex-1">
            <input
              type={showToken ? "text" : "password"}
              placeholder="ADMIN_TOKEN"
              className="w-full rounded-md border border-input bg-background/60 px-3 py-2 pr-10 text-sm font-mono focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
              value={token}
              onChange={(e) => saveToken(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
              aria-label={showToken ? "Hide token" : "Show token"}
            >
              {showToken ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
          <div
            className={`flex h-2 w-2 shrink-0 rounded-full ${
              token.trim() ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" : "bg-muted"
            }`}
            aria-hidden
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Manual actions */}
        <Card className="glass-card lg:col-span-2">
          <CardHeader className="flex flex-row items-center gap-2 space-y-0">
            <Wand2 className="h-5 w-5 text-primary" />
            <CardTitle>Manual triggers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Cron runs <strong>daily at 06:00 UTC</strong> (scrape) and{" "}
              <strong>14:00 UTC</strong> (outreach) on Vercel Hobby. Use the buttons
              below to trigger a run on demand.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <ActionTile
                title="Run scrape now"
                description="Fetch VA / remote-support jobs from RemoteOK, WeWorkRemotely, HN, run them through the LLM filter, discover contacts, and email the daily digest."
                disabled={loading !== null}
                loading={loading === "Scrape"}
                onClick={() => runManual("/api/manual/scrape", "Scrape")}
                icon={<Play className="h-5 w-5" />}
                gradient="from-violet-500/30 to-fuchsia-500/20"
                primary
              />
              <ActionTile
                title="Run outreach now"
                description="Draft and send pending outreach emails through the guardrails layer. Respects DRY_RUN."
                disabled={loading !== null}
                loading={loading === "Outreach"}
                onClick={() => runManual("/api/manual/outreach", "Outreach")}
                icon={<Mail className="h-5 w-5" />}
                gradient="from-sky-500/30 to-emerald-500/20"
              />
            </div>

            {lastRun && (
              <div
                className={`rounded-lg border p-4 ${
                  lastRun.ok
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-red-500/30 bg-red-500/5"
                }`}
              >
                <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                  {lastRun.ok ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-red-400" />
                  )}
                  <span>
                    {lastRun.label} {lastRun.ok ? "succeeded" : "failed"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(lastRun.at).toLocaleTimeString()}
                  </span>
                </div>
                {lastRun.error && (
                  <p className="text-sm text-red-300">{lastRun.error}</p>
                )}
                {lastRun.data && (
                  <pre className="mt-2 max-h-60 overflow-auto rounded bg-background/60 p-3 text-xs font-mono text-muted-foreground">
                    {JSON.stringify(lastRun.data, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Toggles */}
        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center gap-2 space-y-0">
            <Sparkles className="h-5 w-5 text-primary" />
            <CardTitle>Agent toggles</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <ToggleRow
              label="Dry run"
              hint="Drafts and queues emails without actually delivering them."
              checked={settings.DRY_RUN}
              onChange={(v) => patchSettings({ DRY_RUN: v })}
            />
            <ToggleRow
              label="Agent enabled"
              hint="Master switch — when off, no outreach sends."
              checked={settings.AGENT_ENABLED}
              onChange={(v) => patchSettings({ AGENT_ENABLED: v })}
            />
          </CardContent>
        </Card>

        {/* Env table */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle>Environment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 font-mono text-xs">
            {Object.entries(maskedEnv).map(([k, v]) => (
              <div
                key={k}
                className="flex items-center justify-between gap-4 rounded-md border border-border/30 bg-background/30 px-3 py-2"
              >
                <span className="text-muted-foreground">{k}</span>
                <span className="truncate text-right text-foreground/90">
                  {String(v)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border/30 bg-background/30 p-3">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function ActionTile({
  title,
  description,
  onClick,
  disabled,
  loading,
  icon,
  gradient,
  primary,
}: {
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon: React.ReactNode;
  gradient: string;
  primary?: boolean;
}) {
  return (
    <div
      className={`group relative overflow-hidden rounded-xl border border-border/40 bg-gradient-to-br ${gradient} p-5 transition hover:border-primary/60`}
    >
      <div className="mb-3 flex items-center gap-2 text-foreground">
        <div className="rounded-md bg-background/60 p-2 ring-1 ring-border/50">
          {icon}
        </div>
        <h4 className="font-semibold">{title}</h4>
      </div>
      <p className="mb-4 text-xs text-foreground/80">{description}</p>
      <Button
        onClick={onClick}
        disabled={disabled}
        variant={primary ? "default" : "outline"}
        size="sm"
        className="w-full"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Running…
          </>
        ) : (
          <>Run now</>
        )}
      </Button>
    </div>
  );
}
