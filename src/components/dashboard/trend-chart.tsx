"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function TrendChart({
  trend,
}: {
  trend: Array<{ day: string; total: number }>;
}) {
  const data = trend.map((t) => ({
    day: new Date(t.day).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
    emails: t.total,
  }));

  return (
    <Card className="glass-card border-amber-900/15">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Emails sent</CardTitle>
        <span className="text-xs text-muted-foreground">last 30d</span>
      </CardHeader>
      <CardContent className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="emailGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#b45309" stopOpacity={0.55} />
                <stop offset="100%" stopColor="#fbbf24" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(120, 53, 15, 0.08)" />
            <XAxis dataKey="day" stroke="#6b5340" fontSize={11} tickLine={false} axisLine={false} />
            <YAxis stroke="#6b5340" fontSize={11} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{
                background: "rgba(254, 247, 224, 0.97)",
                border: "1px solid rgba(120, 53, 15, 0.2)",
                borderRadius: 10,
                color: "#3a2817",
              }}
              labelStyle={{ color: "#3a2817" }}
            />
            <Area
              type="monotone"
              dataKey="emails"
              stroke="#b45309"
              strokeWidth={2}
              fill="url(#emailGrad)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
