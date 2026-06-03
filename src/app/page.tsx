import { StatsCards } from "@/components/dashboard/stats-cards";
import { StatusIndicator } from "@/components/dashboard/status-indicator";
import { PipelineFunnel } from "@/components/dashboard/pipeline-funnel";
import { TrendChart } from "@/components/dashboard/trend-chart";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { getDashboardStats, getEmailsSentPerDay, listRecentEvents, getLastSuccessfulRunAt } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const stats = await getDashboardStats("7d");
  const trend = await getEmailsSentPerDay(30);
  const activity = await listRecentEvents(20, 0);
  const lastRunAt = await getLastSuccessfulRunAt();

  const activityMapped = activity.map((e) => ({
    id: e.id,
    level: e.level,
    message: e.message,
    createdAt: e.createdAt.toISOString(),
  }));

  const trendMapped = trend.map((t) => ({
    day: String(t.day),
    total: Number(t.total),
  }));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pipeline dashboard</h1>
          <p className="mt-1 text-muted-foreground">
            Autonomous scrape → filter → outreach for TalentBridge staffing
          </p>
        </div>
        <StatusIndicator lastRunAt={lastRunAt?.toISOString() ?? null} />
      </div>

      <StatsCards stats={stats} />

      <div className="grid gap-6 lg:grid-cols-2">
        <PipelineFunnel stats={stats} />
        <TrendChart trend={trendMapped} />
      </div>

      <RecentActivity events={activityMapped} />
    </div>
  );
}
