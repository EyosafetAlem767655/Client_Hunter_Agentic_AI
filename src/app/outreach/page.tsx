import Link from "next/link";
import { OutreachClient } from "@/components/outreach/outreach-client";
import type { OutreachRow } from "@/components/outreach/email-detail-drawer";
import { DbErrorBanner } from "@/components/dashboard/db-error-banner";
import { GrokChat } from "@/components/outreach/grok-chat";
import { listOutreachPaginated } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

const WINDOWS: Array<{ value: string; label: string }> = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "All time" },
];

export default async function OutreachPage({
  searchParams,
}: {
  searchParams?: { status?: string; window?: string };
}) {
  const statuses = ["pending", "sent", "bounced", "replied"] as const;
  const initialTab =
    searchParams?.status && (statuses as readonly string[]).includes(searchParams.status)
      ? (searchParams.status as (typeof statuses)[number])
      : "pending";
  const activeWindow = searchParams?.window ?? "24h";
  const timeWindow = activeWindow === "all" ? undefined : activeWindow;

  const byStatus: Record<string, OutreachRow[]> = {};
  let error: string | null = null;

  try {
    for (const status of statuses) {
      const { items } = await listOutreachPaginated({
        status,
        timeWindow,
        page: 1,
        pageSize: 100,
      });
      byStatus[status] = items.map(({ email, contact, posting }) => ({
        id: email.id,
        subject: email.subject,
        body: email.body,
        status: email.status,
        recipient: contact.email,
        company: posting.company,
        jobTitle: posting.title,
      }));
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load outreach";
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Outreach</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeWindow === "all" ? "All time" : `Last ${activeWindow}`} ·{" "}
            {Object.values(byStatus).reduce((a, b) => a + b.length, 0)} emails
          </p>
        </div>
        <div className="inline-flex rounded-xl border border-amber-900/15 bg-white/50 p-1 backdrop-blur">
          {WINDOWS.map((w) => (
            <Link
              key={w.value}
              href={{
                pathname: "/outreach",
                query: { window: w.value, status: initialTab },
              }}
              className={`rounded-lg px-3 py-1.5 text-sm transition ${
                activeWindow === w.value
                  ? "bg-gradient-to-r from-amber-700 to-orange-600 text-white shadow"
                  : "text-foreground/70 hover:text-foreground"
              }`}
            >
              {w.label}
            </Link>
          ))}
        </div>
      </div>

      {error && <DbErrorBanner message={error} />}
      {!error && <OutreachClient byStatus={byStatus} initialTab={initialTab} />}

      <GrokChat />
    </div>
  );
}
