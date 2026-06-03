"use client";

import type { OutreachRow } from "./email-detail-drawer";

export function EmailQueue({
  rows,
  onSelect,
}: {
  rows: OutreachRow[];
  onSelect: (row: OutreachRow) => void;
}) {
  return (
    <div className="glass-card overflow-hidden rounded-xl">
      <table className="w-full text-sm">
        <thead className="border-b border-border/50 bg-muted/30 text-left text-muted-foreground">
          <tr>
            <th className="p-4">Subject</th>
            <th className="p-4">To</th>
            <th className="p-4">Company</th>
            <th className="p-4">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="cursor-pointer border-b border-border/30 hover:bg-accent/20"
              onClick={() => onSelect(row)}
            >
              <td className="p-4">{row.subject}</td>
              <td className="p-4 font-mono text-xs">{row.recipient}</td>
              <td className="p-4">{row.company}</td>
              <td className="p-4 capitalize">{row.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
