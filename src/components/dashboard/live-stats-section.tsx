"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle2,
  Inbox,
  Mail,
  RefreshCw,
  Send,
  Sparkles,
  UserSearch,
} from "lucide-react";

type Stats = {
  scraped: number;
  relevant: number;
  contactsFound: number;
  drafted: number;
  sent: number;
  replied: number;
};

const META = [
  {
    key: "scraped" as const,
    label: "Scraped",
    hint: "Jobs ingested",
    icon: Inbox,
    grad: "from-amber-200/70 via-amber-100/40 to-transparent",
    ring: "ring-amber-700/30",
    href: (w: string) => `/jobs?window=${w}`,
  },
  {
    key: "relevant" as const,
    label: "Relevant",
    hint: "Passed LLM filter",
    icon: Sparkles,
    grad: "from-orange-200/70 via-orange-100/40 to-transparent",
    ring: "ring-orange-700/30",
    href: (w: string) => `/jobs?status=relevant&window=${w}`,
  },
  {
    key: "contactsFound" as const,
    label: "Contacts",
    hint: "Discovered emails",
    icon: UserSearch,
    grad: "from-yellow-200/70 via-yellow-100/40 to-transparent",
    ring: "ring-yellow-700/30",
    href: (w: string) => `/jobs?status=with-contact&window=${w}`,
  },
  {
    key: "drafted" as const,
    label: "Drafted",
    hint: "Outreach queued",
    icon: Mail,
    grad: "from-stone-200/70 via-stone-100/40 to-transparent",
    ring: "ring-stone-700/30",
    href: (w: string) => `/outreach?status=pending&window=${w}`,
  },
  {
    key: "sent" as const,
    label: "Sent",
    hint: "Delivered",
    icon: Send,
    grad: "from-amber-300/70 via-amber-200/40 to-transparent",
    ring: "ring-amber-800/30",
    href: (w: string) => `/outreach?status=sent&window=${w}`,
  },
  {
    key: "replied" as const,
    label: "Replied",
    hint: "Lead engaged",
    icon: CheckCircle2,
    grad: "from-orange-300/70 via-orange-200/40 to-transparent",
    ring: "ring-orange-800/30",
    href: () => `/outreach?status=replied`,
  },
];

const WINDOWS = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
];

export function LiveStatsSection() {
  const searchParams = useSearchParams();
  const timeWindow = WINDOWS.some((w) => w.value === searchParams.get("window"))
    ? (searchParams.get("window") as string)
    : "24h";

  const [stats, setStats] = useState<Stats | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchStats = useCallback(
    async (quiet = false) => {
      if (!quiet) setSpinning(true);
      try {
        const res = await fetch(`/api/dashboard/stats?window=${timeWindow}`);
        const data = await res.json();
        if (data.ok) {
          setStats(data.stats as Stats);
          setLastUpdated(new Date());
        }
      } catch {
        // ignore network errors — stale data stays
      } finally {
        if (!quiet) setSpinning(false);
      }
    },
    [timeWindow]
  );

  // Fetch on mount and whenever time window changes
  useEffect(() => {
    void fetchStats(false);
  }, [fetchStats]);

  // Auto-refresh every 15 seconds while the tab is visible
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void fetchStats(true);
    }, 15_000);
    return () => clearInterval(id);
  }, [fetchStats]);

  const windowLabel =
    timeWindow === "24h"
      ? "Last 24 hours"
      : timeWindow === "7d"
        ? "Last 7 days"
        : "Last 30 days";

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-primary/80">
            {windowLabel}
          </span>
          <h2 className="text-2xl font-bold tracking-tight">
            Pipeline at a glance
          </h2>
          <p className="text-xs text-muted-foreground">
            {lastUpdated
              ? `Updated ${lastUpdated.toLocaleTimeString()}`
              : "Loading…"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchStats(false)}
            title="Refresh now"
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-900/15 bg-white/50 px-3 py-1.5 text-xs font-medium text-foreground/70 backdrop-blur transition hover:border-amber-900/30 hover:text-foreground"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${spinning ? "animate-spin" : ""}`} />
            Refresh
          </button>

          <div className="inline-flex rounded-xl border border-amber-900/15 bg-white/50 p-1 backdrop-blur">
            {WINDOWS.map((opt) => (
              <Link
                key={opt.value}
                href={`/?window=${opt.value}`}
                scroll={false}
                className={`rounded-lg px-3 py-1.5 text-sm transition ${
                  timeWindow === opt.value
                    ? "bg-gradient-to-r from-amber-700 to-orange-600 text-white shadow"
                    : "text-foreground/70 hover:text-foreground"
                }`}
              >
                {opt.label}
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {META.map((meta) => {
          const Icon = meta.icon;
          const value = stats?.[meta.key] ?? 0;
          return (
            <Link
              key={meta.key}
              href={meta.href(timeWindow)}
              aria-label={`Drill into ${meta.label}`}
              className={`group relative block overflow-hidden rounded-2xl border border-amber-900/15 bg-gradient-to-br ${meta.grad} p-5 backdrop-blur-xl transition hover:border-amber-900/30 hover:-translate-y-0.5 hover:shadow-2xl hover:shadow-amber-900/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60`}
            >
              <div
                className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-amber-200/40 blur-2xl transition group-hover:scale-110"
                aria-hidden
              />
              <div className="relative flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {meta.label}
                  </p>
                  <p className="mt-3 text-3xl font-bold tabular-nums text-foreground">
                    {stats === null ? (
                      <span className="text-muted-foreground/50">—</span>
                    ) : (
                      value.toLocaleString()
                    )}
                  </p>
                  <p className="mt-1 text-xs text-foreground/60">{meta.hint}</p>
                </div>
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-xl bg-white/70 ring-1 ${meta.ring}`}
                >
                  <Icon className="h-4 w-4 text-foreground/80" />
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
