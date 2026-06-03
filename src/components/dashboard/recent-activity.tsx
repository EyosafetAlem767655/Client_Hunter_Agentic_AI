"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface ActivityEvent {
  id: number;
  level: string;
  message: string;
  createdAt: string;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function RecentActivity({ events }: { events: ActivityEvent[] }) {
  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
      </CardHeader>
      <CardContent className="max-h-96 space-y-3 overflow-y-auto">
        {events.length === 0 && (
          <p className="text-sm text-muted-foreground">No events yet.</p>
        )}
        {events.map((e) => (
          <div
            key={e.id}
            className="flex items-start justify-between gap-4 border-b border-border/30 pb-2 text-sm last:border-0"
          >
            <span
              className={cn(
                "shrink-0 rounded px-1.5 py-0.5 text-xs font-mono uppercase",
                e.level === "error" && "bg-red-500/20 text-red-400",
                e.level === "warn" && "bg-amber-500/20 text-amber-400",
                e.level === "info" && "bg-blue-500/20 text-blue-400"
              )}
            >
              {e.level}
            </span>
            <span className="flex-1 text-foreground/90">{e.message}</span>
            <span className="shrink-0 text-muted-foreground">
              {relativeTime(e.createdAt)}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
