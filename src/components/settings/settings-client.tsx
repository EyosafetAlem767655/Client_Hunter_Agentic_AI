"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

const TOKEN_KEY = "talentbridge_admin_token";

export function SettingsClient({
  initial,
  maskedEnv,
}: {
  initial: { DRY_RUN: boolean; AGENT_ENABLED: boolean };
  maskedEnv: Record<string, string | boolean>;
}) {
  const [settings, setSettings] = useState(initial);
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem(TOKEN_KEY);
    if (saved) setToken(saved);
  }, []);

  function saveToken(value: string) {
    setToken(value);
    if (value) sessionStorage.setItem(TOKEN_KEY, value);
    else sessionStorage.removeItem(TOKEN_KEY);
  }

  async function patchSettings(patch: Partial<typeof settings>) {
    if (!token.trim()) {
      setMessage("Enter your ADMIN_TOKEN first (from Vercel env vars).");
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
      setMessage("Failed to update settings — check ADMIN_TOKEN matches Vercel exactly.");
      return;
    }
    setSettings((s) => ({ ...s, ...patch }));
    setMessage("Settings updated");
  }

  async function runManual(path: string, label: string) {
    if (!token.trim()) {
      setMessage(
        "Unauthorized — enter ADMIN_TOKEN from Vercel → Settings → Environment Variables."
      );
      return;
    }
    setLoading(label);
    setMessage(`Running ${label}…`);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { Authorization: `Bearer ${token.trim()}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Unauthorized — token does not match ADMIN_TOKEN on Vercel.");
        return;
      }
      setMessage(`${label} complete: ${JSON.stringify(data)}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Environment (read-only)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 font-mono text-sm">
          {Object.entries(maskedEnv).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <span className="text-muted-foreground">{k}</span>
              <span>{String(v)}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Agent toggles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <span>Dry run (no real sends)</span>
            <Switch
              checked={settings.DRY_RUN}
              onCheckedChange={(v) => patchSettings({ DRY_RUN: v })}
            />
          </div>
          <div className="flex items-center justify-between">
            <span>Agent enabled</span>
            <Switch
              checked={settings.AGENT_ENABLED}
              onCheckedChange={(v) => patchSettings({ AGENT_ENABLED: v })}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Manual actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Daily scrape runs automatically at <strong>06:00 UTC</strong> via Vercel
            cron (Python scrapers). Paste your <code className="rounded bg-muted px-1">ADMIN_TOKEN</code> to
            trigger manually.
          </p>
          <input
            type="password"
            placeholder="ADMIN_TOKEN from Vercel env vars"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={token}
            onChange={(e) => saveToken(e.target.value)}
          />
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={loading === "scrape"}
              onClick={() => runManual("/api/manual/scrape", "Python scrape")}
            >
              {loading === "scrape" ? "Scraping…" : "Run scrape now"}
            </Button>
            <Button
              variant="outline"
              disabled={loading === "outreach"}
              onClick={() => runManual("/api/manual/outreach", "Outreach")}
            >
              {loading === "outreach" ? "Running…" : "Run outreach now"}
            </Button>
          </div>
          {message && (
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{message}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
