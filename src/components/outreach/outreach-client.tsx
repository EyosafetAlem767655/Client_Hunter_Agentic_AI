"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmailQueue } from "./email-queue";
import {
  EmailDetailDrawer,
  type OutreachRow,
} from "./email-detail-drawer";

export function OutreachClient({
  byStatus,
  initialTab = "pending",
}: {
  byStatus: Record<string, OutreachRow[]>;
  initialTab?: string;
}) {
  const [selected, setSelected] = useState<OutreachRow | null>(null);

  const tabs = [
    { key: "pending", label: "Queue" },
    { key: "sent", label: "Sent" },
    { key: "bounced", label: "Bounced" },
    { key: "replied", label: "Replied" },
  ];

  return (
    <>
      <Tabs defaultValue={initialTab}>
        <TabsList>
          {tabs.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label} ({byStatus[t.key]?.length ?? 0})
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((t) => (
          <TabsContent key={t.key} value={t.key} className="mt-4">
            <EmailQueue
              rows={byStatus[t.key] ?? []}
              onSelect={setSelected}
            />
          </TabsContent>
        ))}
      </Tabs>
      <EmailDetailDrawer
        row={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
