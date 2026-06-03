"use client";

import { motion, useSpring, useTransform } from "framer-motion";
import { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function AnimatedNumber({ value }: { value: number }) {
  const spring = useSpring(0, { stiffness: 80, damping: 20 });
  const display = useTransform(spring, (v) => Math.round(v).toLocaleString());

  useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  return <motion.span>{display}</motion.span>;
}

const labels: Record<string, string> = {
  scraped: "Scraped",
  relevant: "Relevant",
  contactsFound: "Contacts",
  drafted: "Drafted",
  sent: "Sent",
  replied: "Replied",
};

export function StatsCards({
  stats,
}: {
  stats: Record<string, number>;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {Object.entries(labels).map(([key, label]) => (
        <Card key={key} className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {label}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">
              <AnimatedNumber value={stats[key] ?? 0} />
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
