"use client";

import {
  Bar,
  BarChart,
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
    <Card className="glass-card">
      <CardHeader>
        <CardTitle>Emails sent (30 days)</CardTitle>
      </CardHeader>
      <CardContent className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis dataKey="day" stroke="#94a3b8" fontSize={12} />
            <YAxis stroke="#94a3b8" fontSize={12} />
            <Tooltip
              contentStyle={{
                background: "hsl(222 40% 10%)",
                border: "1px solid hsl(217 33% 20%)",
              }}
            />
            <Bar dataKey="emails" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
