import { NextResponse } from "next/server";
import { sendSingleOutreach } from "@/lib/agent/action";
import { memory } from "@/lib/agent/memory";
import { verifyAdminAuth } from "@/lib/auth";
import { env } from "@/lib/env";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  if (!verifyAdminAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = Number(params.id);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  await memory.updateOutreachStatus(id, "approved");

  const dbDryRun = await memory.getSetting("DRY_RUN");
  const dryRun = dbDryRun !== null ? dbDryRun === "true" : env.DRY_RUN;
  const dbEnabled = await memory.getSetting("AGENT_ENABLED");
  const agentEnabled =
    dbEnabled !== null ? dbEnabled === "true" : env.AGENT_ENABLED;

  const result = await sendSingleOutreach(id, dryRun, agentEnabled);

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }

  return NextResponse.json({ ok: true, id, dryRun });
}
