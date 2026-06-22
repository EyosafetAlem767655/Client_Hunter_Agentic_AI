import { AlertTriangle, CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import type { ScrapeSourceStatus } from "@/types";

export function SourceStatusComparison({
  sources,
}: {
  sources: ScrapeSourceStatus[];
}) {
  return (
    <div className="glass-card overflow-hidden rounded-xl">
      <table className="w-full text-sm">
        <thead className="border-b border-border/50 bg-muted/30 text-left text-muted-foreground">
          <tr>
            <th className="p-4">Job site</th>
            <th className="p-4">Status</th>
            <th className="p-4">Fetched</th>
            <th className="p-4">Detail</th>
          </tr>
        </thead>
        <tbody>
          {sources.length === 0 && (
            <tr>
              <td colSpan={4} className="p-8 text-center text-muted-foreground">
                Source status is unavailable until the first scrape run.
              </td>
            </tr>
          )}
          {sources.map((source) => (
            <tr key={source.source} className="border-b border-border/30">
              <td className="p-4 font-medium">{source.label}</td>
              <td className="p-4">
                <StatusPill status={source.status} ok={source.ok} />
              </td>
              <td className="p-4 font-mono text-xs">{source.count ?? 0}</td>
              <td className="p-4 text-xs text-muted-foreground">
                {sourceDetail(source)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function sourceDetail(source: ScrapeSourceStatus): string {
  if (source.ok) return "Scraped successfully";
  if (source.status === "not_attempted") return "Not attempted yet";
  if (source.status === "not_configured") {
    return source.error ?? "Missing required source configuration";
  }
  if (source.error?.includes("HTTP 500")) {
    return "The job site returned HTTP 500, so this source was skipped for this run.";
  }
  return source.error ?? "This source rejected or blocked the scrape attempt.";
}

function StatusPill({
  status,
  ok,
}: {
  status: ScrapeSourceStatus["status"];
  ok: boolean;
}) {
  const config =
    status === "scraped" && ok
      ? {
          label: "Scraped",
          icon: CheckCircle2,
          className: "bg-emerald-100 text-emerald-900",
        }
      : status === "not_configured"
        ? {
            label: "Not configured",
            icon: AlertTriangle,
            className: "bg-amber-100 text-amber-900",
          }
        : status === "not_attempted"
          ? {
              label: "Not attempted",
              icon: CircleDashed,
              className: "bg-muted text-muted-foreground",
            }
          : {
              label: "Rejected",
              icon: XCircle,
              className: "bg-red-100 text-red-900",
            };
  const Icon = config.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${config.className}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {config.label}
    </span>
  );
}
