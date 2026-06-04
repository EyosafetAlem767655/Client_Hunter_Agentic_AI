import {
  getDashboardStats,
  getEmailsSentPerDay,
  getLastSuccessfulRunAt,
  listRecentEvents,
} from "./queries";

const EMPTY_STATS = {
  scraped: 0,
  relevant: 0,
  contactsFound: 0,
  drafted: 0,
  sent: 0,
  replied: 0,
};

export async function safeDashboardData() {
  try {
    const [stats, trend, activity, lastRunAt] = await Promise.all([
      getDashboardStats("7d"),
      getEmailsSentPerDay(30),
      listRecentEvents(20, 0),
      getLastSuccessfulRunAt(),
    ]);

    return {
      ok: true as const,
      stats,
      trend: trend.map((t) => ({
        day: String(t.day),
        total: Number(t.total),
      })),
      activity: activity.map((e) => ({
        id: e.id,
        level: e.level,
        message: e.message,
        createdAt: e.createdAt.toISOString(),
      })),
      lastRunAt: lastRunAt?.toISOString() ?? null,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Database query failed";
    return {
      ok: false as const,
      error: message,
      stats: EMPTY_STATS,
      trend: [] as Array<{ day: string; total: number }>,
      activity: [] as Array<{
        id: number;
        level: string;
        message: string;
        createdAt: string;
      }>,
      lastRunAt: null as string | null,
    };
  }
}
