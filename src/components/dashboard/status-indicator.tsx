"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function StatusIndicator({ lastRunAt }: { lastRunAt: string | null }) {
  let status: "healthy" | "warning" | "critical" = "critical";
  let label = "No recent runs";

  if (lastRunAt) {
    const hours =
      (Date.now() - new Date(lastRunAt).getTime()) / (1000 * 60 * 60);
    if (hours < 24) {
      status = "healthy";
      label = "Pipeline healthy";
    } else if (hours < 48) {
      status = "warning";
      label = "Stale — check cron";
    } else {
      status = "critical";
      label = "Pipeline idle";
    }
  }

  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-2 px-3 py-1",
        status === "healthy" && "border-amber-700/50 text-amber-800",
        status === "warning" && "border-amber-500/50 text-amber-400",
        status === "critical" && "border-red-500/50 text-red-400"
      )}
    >
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          status === "healthy" && "animate-pulse bg-amber-600",
          status === "warning" && "bg-amber-400",
          status === "critical" && "bg-red-400"
        )}
      />
      {label}
    </Badge>
  );
}
