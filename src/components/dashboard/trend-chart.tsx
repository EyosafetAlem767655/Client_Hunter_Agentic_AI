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
    <Card className="glass-card border-white/10">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Emails sent</CardTitle>
        <span className="text-xs text-muted-foreground">last 30d</span>
      </CardHeader>
      <CardContent className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="emailGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.55} />
                <stop offset="100%" stopColor="#06b6d4" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="day" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
            <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{
                background: "rgba(15, 14, 28, 0.95)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 10,
                color: "#f1f5f9",
              }}
              labelStyle={{ color: "#e2e8f0" }}
            />
            <Area
              type="monotone"
              dataKey="emails"
              stroke="#5eead4"
              strokeWidth={2}
              fill="url(#emailGrad)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
