import { SettingsClient } from "@/components/settings/settings-client";
import { DbErrorBanner } from "@/components/dashboard/db-error-banner";
import { getSetting } from "@/lib/db/queries";
import { env } from "@/lib/env";
import { maskSecret } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  let dryRun = String(env.DRY_RUN);
  let agentEnabled = String(env.AGENT_ENABLED);
  let dbError: string | null = null;

  try {
    dryRun = (await getSetting("DRY_RUN")) ?? dryRun;
    agentEnabled = (await getSetting("AGENT_ENABLED")) ?? agentEnabled;
  } catch (e) {
    dbError = e instanceof Error ? e.message : "Database unavailable";
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Settings</h1>
      {dbError && <DbErrorBanner message={dbError} />}
      <SettingsClient
        initial={{
          DRY_RUN: dryRun === "true",
          AGENT_ENABLED: agentEnabled === "true",
        }}
        maskedEnv={{
          OPENAI_API_KEY: maskSecret(env.OPENAI_API_KEY),
          DATABASE_URL: maskSecret(env.DATABASE_URL),
          GMAIL_USER: env.GMAIL_USER,
          GMAIL_APP_PASSWORD: maskSecret(env.GMAIL_APP_PASSWORD),
          ADMIN_TOKEN: maskSecret(env.ADMIN_TOKEN),
          DRY_RUN: env.DRY_RUN,
          AGENT_ENABLED: env.AGENT_ENABLED,
        }}
      />
    </div>
  );
}
