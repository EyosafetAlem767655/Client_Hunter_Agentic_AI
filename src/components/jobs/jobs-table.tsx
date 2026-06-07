"use client";

import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface JobRow {
  id: number;
  title: string;
  company: string;
  score: number | null;
  isRelevant: boolean | null;
  fitReason: string | null;
  description: string;
  url: string;
  scrapedAt?: string | null;
  contactEmail?: string | null;
  contactUrl?: string | null;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function JobsTable({ jobs }: { jobs: JobRow[] }) {
  const [selected, setSelected] = useState<JobRow | null>(null);

  return (
    <>
      <div className="glass-card overflow-hidden rounded-xl">
        <table className="w-full text-sm">
          <thead className="border-b border-border/50 bg-muted/30 text-left text-muted-foreground">
            <tr>
              <th className="p-4">Title</th>
              <th className="p-4">Company</th>
              <th className="p-4">Scraped</th>
              <th className="p-4">Contact</th>
              <th className="p-4">Score</th>
              <th className="p-4">Status</th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">
                  No jobs match this filter yet.
                </td>
              </tr>
            )}
            {jobs.map((job) => (
              <tr
                key={job.id}
                className="cursor-pointer border-b border-border/30 transition-colors hover:bg-accent/20"
                onClick={() => setSelected(job)}
              >
                <td className="p-4 font-medium">{job.title}</td>
                <td className="p-4">{job.company}</td>
                <td className="p-4 whitespace-nowrap text-xs text-muted-foreground">
                  {job.scrapedAt ? relativeTime(job.scrapedAt) : "—"}
                </td>
                <td className="p-4 text-xs">
                  {job.contactEmail ? (
                    <span className="rounded bg-amber-200 px-2 py-0.5 text-amber-900">
                      {job.contactEmail}
                    </span>
                  ) : job.contactUrl ? (
                    <a
                      href={job.contactUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded bg-orange-100 px-2 py-0.5 text-orange-900 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      URL only
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          (job.score ?? 0) >= 70
                            ? "bg-amber-700"
                            : (job.score ?? 0) >= 40
                              ? "bg-orange-500"
                              : "bg-red-500"
                        )}
                        style={{ width: `${job.score ?? 0}%` }}
                      />
                    </div>
                    <span className="font-mono text-xs">{job.score ?? "—"}</span>
                  </div>
                </td>
                <td className="p-4">
                  {job.isRelevant === null ? (
                    <Badge variant="outline">Unfiltered</Badge>
                  ) : job.isRelevant ? (
                    <Badge>Relevant</Badge>
                  ) : (
                    <Badge variant="secondary">Skipped</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetTrigger className="hidden" />
        <SheetContent>
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.title}</SheetTitle>
              </SheetHeader>
              <p className="mt-2 text-sm text-muted-foreground">{selected.company}</p>
              <a
                href={selected.url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 block text-sm text-primary hover:underline"
              >
                View posting
              </a>
              {selected.fitReason && (
                <div className="mt-4 rounded-lg bg-muted/40 p-4">
                  <h4 className="text-sm font-semibold">LLM reasoning</h4>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {selected.fitReason}
                  </p>
                </div>
              )}
              <div className="mt-4 max-h-96 overflow-y-auto whitespace-pre-wrap text-sm">
                {selected.description.slice(0, 3000)}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
