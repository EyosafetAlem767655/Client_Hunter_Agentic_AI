import Link from "next/link";
import { ArrowRight, Globe2, Settings2, Sparkles, Zap } from "lucide-react";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { StatusIndicator } from "@/components/dashboard/status-indicator";
import { PipelineFunnel } from "@/components/dashboard/pipeline-funnel";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { DbErrorBanner } from "@/components/dashboard/db-error-banner";
import { safeDashboardData } from "@/lib/db/safe-queries";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

const WINDOW_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: { window?: string };
}) {
  const requested = searchParams?.window ?? "24h";
  const timeWindow = WINDOW_OPTIONS.some((o) => o.value === requested)
    ? requested
    : "24h";
  const data = await safeDashboardData(timeWindow);
  const dryRun = env.DRY_RUN;

  return (
    <div className="space-y-10">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl border border-amber-900/15 bg-gradient-to-br from-amber-200/40 via-orange-100/40 to-amber-50/40 p-8 sm:p-10 backdrop-blur-xl">
        <div
          className="pointer-events-none absolute -left-20 -top-20 h-72 w-72 rounded-full bg-amber-300/40 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-32 -right-16 h-80 w-80 rounded-full bg-orange-300/30 blur-3xl"
          aria-hidden
        />

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-amber-900/15 bg-white/40 px-3 py-1 text-xs font-medium text-amber-900 backdrop-blur">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-600 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-600" />
              </span>
              Agentic pipeline · {dryRun ? "Dry run" : "Live"}
            </div>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
              <span className="bg-gradient-to-r from-amber-800 via-orange-700 to-amber-600 bg-clip-text text-transparent">
                Talent
              </span>
              <span className="text-foreground">Bridge</span>
            </h1>
            <p className="mt-3 text-base text-foreground/80 sm:text-lg">
              Top-tier talent. Sensible overhead.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/settings"
                className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-700 to-orange-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-amber-900/30 transition hover:from-amber-600 hover:to-orange-500"
              >
                <Zap className="h-4 w-4" />
                Run scrape now
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/jobs"
                className="inline-flex items-center gap-2 rounded-xl border border-amber-900/15 bg-white/50 px-5 py-3 text-sm font-medium text-foreground/90 backdrop-blur transition hover:border-amber-900/30 hover:bg-white/70"
              >
                Browse jobs
              </Link>
            </div>
          </div>
          <StatusIndicator lastRunAt={data.lastRunAt} />
        </div>

        <div className="relative mt-8 grid gap-3 sm:grid-cols-3">
          <FeaturePill
            icon={<Globe2 className="h-4 w-4" />}
            text="7 sources · US + Europe"
          />
          <FeaturePill
            icon={<Sparkles className="h-4 w-4" />}
            text="GPT-scored VA fit"
          />
          <FeaturePill
            icon={<Settings2 className="h-4 w-4" />}
            text="Daily cron · 06:00 UTC"
          />
        </div>
      </section>

      {!data.ok && <DbErrorBanner message={data.error} />}

      {/* KPIs */}
      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary/80">
              {timeWindow === "24h"
                ? "Last 24 hours"
                : timeWindow === "7d"
                  ? "Last 7 days"
                  : "Last 30 days"}
            </span>
            <h2 className="text-2xl font-bold tracking-tight">
              Pipeline at a glance
            </h2>
            <p className="text-sm text-muted-foreground">
              Click any tile to drill into the underlying records.
            </p>
          </div>
          <div className="inline-flex rounded-xl border border-amber-900/15 bg-white/50 p-1 backdrop-blur">
            {WINDOW_OPTIONS.map((opt) => (
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
        <StatsCards stats={data.stats} timeWindow={timeWindow} />
      </section>

      {/* Funnel + Trend */}
      <section className="grid gap-6 lg:grid-cols-2">
        <PipelineFunnel stats={data.stats} />
        <TrendChart trend={data.trend} />
      </section>

      {/* Activity */}
      <section>
        <SectionHeader
          eyebrow="Live log"
          title="Recent activity"
          subtitle="Everything the agent did, in order."
        />
        <RecentActivity events={data.activity} />
      </section>
    </div>
  );
}

function FeaturePill({
  icon,
  text,
}: {
  icon: React.ReactNode;
  text: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-amber-900/15 bg-white/50 px-4 py-2 text-sm text-foreground/85 backdrop-blur">
      <span className="text-primary">{icon}</span>
      {text}
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-4 flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wider text-primary/80">
        {eyebrow}
      </span>
      <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}
