import { NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/db/queries";
import { verifyAdminAuth } from "@/lib/auth";
import { env } from "@/lib/env";
import { maskSecret } from "@/lib/utils";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET() {
  const dryRun = (await getSetting("DRY_RUN")) ?? String(env.DRY_RUN);
  const agentEnabled =
    (await getSetting("AGENT_ENABLED")) ?? String(env.AGENT_ENABLED);
  const clayAutoEnrich = (await getSetting("clay_auto_enrich_enabled")) ?? "false";

  return NextResponse.json({
    env: {
      GEMINI_API_KEY: maskSecret(env.GEMINI_API_KEY),
      DATABASE_URL: maskSecret(env.DATABASE_URL),
      GMAIL_USER: env.GMAIL_USER,
      GMAIL_APP_PASSWORD: maskSecret(env.GMAIL_APP_PASSWORD),
      ADMIN_TOKEN: maskSecret(env.ADMIN_TOKEN),
      DRY_RUN: env.DRY_RUN,
      AGENT_ENABLED: env.AGENT_ENABLED,
      CLAY_API_KEY: maskSecret(env.CLAY_API_KEY ?? ""),
    },
    settings: {
      DRY_RUN: dryRun === "true",
      AGENT_ENABLED: agentEnabled === "true",
      CLAY_AUTO_ENRICH: clayAutoEnrich === "true",
    },
  });
}

const patchSchema = z.object({
  DRY_RUN: z.boolean().optional(),
  AGENT_ENABLED: z.boolean().optional(),
  CLAY_AUTO_ENRICH: z.boolean().optional(),
});

export async function PATCH(request: Request) {
  if (!verifyAdminAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = patchSchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (body.data.DRY_RUN !== undefined) {
    await setSetting("DRY_RUN", String(body.data.DRY_RUN));
  }
  if (body.data.AGENT_ENABLED !== undefined) {
    await setSetting("AGENT_ENABLED", String(body.data.AGENT_ENABLED));
  }
  if (body.data.CLAY_AUTO_ENRICH !== undefined) {
    await setSetting("clay_auto_enrich_enabled", String(body.data.CLAY_AUTO_ENRICH));
  }

  return NextResponse.json({ ok: true });
}
