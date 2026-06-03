import { insertAgentEvent } from "@/lib/db/queries";
import type { EventLevel } from "@/types";

let currentRunId: number | undefined;

export function setRunId(runId: number | undefined) {
  currentRunId = runId;
}

export async function logEvent(
  level: EventLevel,
  message: string,
  context?: Record<string, unknown>
): Promise<void> {
  const safeContext = context ? redactSecrets(context) : undefined;
  const line = `[${level.toUpperCase()}] ${message}`;
  if (level === "error") {
    console.error(line, safeContext);
  } else if (level === "warn") {
    console.warn(line, safeContext);
  } else {
    console.log(line, safeContext);
  }

  try {
    await insertAgentEvent({
      runId: currentRunId,
      level,
      message,
      context: safeContext,
    });
  } catch {
    // DB may be unavailable in some tests
  }
}

function redactSecrets(
  context: Record<string, unknown>
): Record<string, unknown> {
  const sensitive = [
    "OPENAI_API_KEY",
    "GMAIL_APP_PASSWORD",
    "DATABASE_URL",
    "ADMIN_TOKEN",
    "CRON_SECRET",
  ];
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (sensitive.some((s) => key.includes(s) || String(value).includes("sk-"))) {
      out[key] = "[REDACTED]";
    } else {
      out[key] = value;
    }
  }
  return out;
}

export async function withStep<T>(
  name: string,
  fn: () => Promise<T>
): Promise<T | undefined> {
  try {
    await logEvent("info", `Starting: ${name}`);
    const result = await fn();
    await logEvent("info", `Completed: ${name}`);
    return result;
  } catch (error) {
    await logEvent("error", `Failed: ${name}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
