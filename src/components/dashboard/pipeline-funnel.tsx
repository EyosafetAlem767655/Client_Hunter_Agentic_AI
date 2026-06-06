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
    { name: "Scraped", value: stats.scraped ?? 0, fill: "#10b981" },
    { name: "Relevant", value: stats.relevant ?? 0, fill: "#14b8a6" },
    { name: "Contact", value: stats.contactsFound ?? 0, fill: "#06b6d4" },
    { name: "Drafted", value: stats.drafted ?? 0, fill: "#38bdf8" },
    { name: "Sent", value: stats.sent ?? 0, fill: "#fbbf24" },
    { name: "Replied", value: stats.replied ?? 0, fill: "#fb7185" },
  ];

  return (
    <Card className="glass-card border-white/10">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Pipeline funnel</CardTitle>
        <span className="text-xs text-muted-foreground">last 7d</span>
      </CardHeader>
      <CardContent className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <FunnelChart>
            <Tooltip
              contentStyle={{
                background: "rgba(15, 14, 28, 0.95)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 10,
                color: "#f1f5f9",
              }}
            />
            <Funnel dataKey="value" data={data} isAnimationActive>
              <LabelList
                position="right"
                fill="#e2e8f0"
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
