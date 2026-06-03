import { SettingsClient } from "@/components/settings/settings-client";
import { getSetting } from "@/lib/db/queries";
import { env } from "@/lib/env";
import { maskSecret } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const dryRun = (await getSetting("DRY_RUN")) ?? String(env.DRY_RUN);
  const agentEnabled =
    (await getSetting("AGENT_ENABLED")) ?? String(env.AGENT_ENABLED);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Settings</h1>
      <SettingsClient
        initial={{
          DRY_RUN: dryRun === "true",
          AGENT_ENABLED: agentEnabled === "true",
        }}
        maskedEnv={{
          OPENAI_API_KEY: maskSecret(env.OPENAI_API_KEY),
          DATABASE_URL: maskSecret(env.DATABASE_URL),
          GMAIL_APP_PASSWORD: maskSecret(env.GMAIL_APP_PASSWORD),
          ADMIN_TOKEN: maskSecret(env.ADMIN_TOKEN),
          DRY_RUN: env.DRY_RUN,
          AGENT_ENABLED: env.AGENT_ENABLED,
        }}
      />
    </div>
  );
}
