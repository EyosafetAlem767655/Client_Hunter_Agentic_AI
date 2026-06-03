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
    { name: "Scraped", value: stats.scraped ?? 0, fill: "#8b5cf6" },
    { name: "Relevant", value: stats.relevant ?? 0, fill: "#6366f1" },
    { name: "Contact", value: stats.contactsFound ?? 0, fill: "#3b82f6" },
    { name: "Drafted", value: stats.drafted ?? 0, fill: "#0ea5e9" },
    { name: "Sent", value: stats.sent ?? 0, fill: "#14b8a6" },
    { name: "Replied", value: stats.replied ?? 0, fill: "#22c55e" },
  ];

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle>Pipeline funnel</CardTitle>
      </CardHeader>
      <CardContent className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <FunnelChart>
            <Tooltip />
            <Funnel dataKey="value" data={data} isAnimationActive>
              <LabelList position="right" fill="#fff" stroke="none" dataKey="name" />
            </Funnel>
          </FunnelChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
