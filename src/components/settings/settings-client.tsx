"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

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

  async function patchSettings(patch: Partial<typeof settings>) {
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      setMessage("Failed to update settings (check admin token)");
      return;
    }
    setSettings((s) => ({ ...s, ...patch }));
    setMessage("Settings updated");
  }

  async function runManual(path: string) {
    const res = await fetch(path, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    setMessage(res.ok ? `Run complete: ${JSON.stringify(data)}` : data.error);
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
          <input
            type="password"
            placeholder="Admin token"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => runManual("/api/manual/scrape")}>
              Run scrape now
            </Button>
            <Button
              variant="outline"
              onClick={() => runManual("/api/manual/outreach")}
            >
              Run outreach now
            </Button>
          </div>
          {message && (
            <p className="text-sm text-muted-foreground">{message}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
