"use client";

import {
  Funnel,
  FunnelChart,
  LabelList,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function PipelineFunnel({
  stats,
}: {
  stats: Record<string, number>;
}) {
  const data = [
    { name: "Scraped", value: stats.scraped ?? 0, fill: "#92400e" },
    { name: "Relevant", value: stats.relevant ?? 0, fill: "#b45309" },
    { name: "Contact", value: stats.contactsFound ?? 0, fill: "#d97706" },
    { name: "Drafted", value: stats.drafted ?? 0, fill: "#ea580c" },
    { name: "Sent", value: stats.sent ?? 0, fill: "#f59e0b" },
    { name: "Replied", value: stats.replied ?? 0, fill: "#fbbf24" },
  ];

  return (
    <Card className="glass-card border-amber-900/15">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Pipeline funnel</CardTitle>
        <span className="text-xs text-muted-foreground">last 7d</span>
      </CardHeader>
      <CardContent className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <FunnelChart>
            <Tooltip
              contentStyle={{
                background: "rgba(254, 247, 224, 0.97)",
                border: "1px solid rgba(120, 53, 15, 0.2)",
                borderRadius: 10,
                color: "#3a2817",
              }}
            />
            <Funnel dataKey="value" data={data} isAnimationActive>
              <LabelList
                position="right"
                fill="#3a2817"
                stroke="none"
                dataKey="name"
                fontSize={12}
              />
            </Funnel>
          </FunnelChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
