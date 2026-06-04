import { StatsCards } from "@/components/dashboard/stats-cards";
import { StatusIndicator } from "@/components/dashboard/status-indicator";
import { PipelineFunnel } from "@/components/dashboard/pipeline-funnel";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { DbErrorBanner } from "@/components/dashboard/db-error-banner";
import { safeDashboardData } from "@/lib/db/safe-queries";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const data = await safeDashboardData();

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pipeline dashboard</h1>
          <p className="mt-1 text-muted-foreground">
            Autonomous scrape → filter → outreach for TalentBridge staffing
          </p>
        </div>
        <StatusIndicator lastRunAt={data.lastRunAt} />
      </div>

      {!data.ok && <DbErrorBanner message={data.error} />}

      <StatsCards stats={data.stats} />

      <div className="grid gap-6 lg:grid-cols-2">
        <PipelineFunnel stats={data.stats} />
        <TrendChart trend={data.trend} />
      </div>

      <RecentActivity events={data.activity} />
    </div>
  );
}
