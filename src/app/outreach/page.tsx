import { OutreachClient } from "@/components/outreach/outreach-client";
import type { OutreachRow } from "@/components/outreach/email-detail-drawer";
import { listOutreachPaginated } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function OutreachPage() {
  const statuses = ["pending", "sent", "bounced", "replied"] as const;
  const byStatus: Record<string, OutreachRow[]> = {};

  for (const status of statuses) {
    const { items } = await listOutreachPaginated({
      status,
      page: 1,
      pageSize: 50,
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

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Outreach</h1>
      <OutreachClient byStatus={byStatus} />
    </div>
  );
}
