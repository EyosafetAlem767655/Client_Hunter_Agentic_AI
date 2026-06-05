import { z } from "zod";
import { resolveDatabaseUrl } from "./database-url";

/** Normalize Vercel/Neon env before zod validation. */
export function normalizeEnv(
  source: Record<string, string | undefined> = process.env
): void {
  const dbUrl = resolveDatabaseUrl(source);
  if (dbUrl) {
    source.DATABASE_URL = dbUrl;
  }

  if (!source.GMAIL_USER && source.CONTACT_EMAIL) {
    source.GMAIL_USER = source.CONTACT_EMAIL;
  }

  if (!source.OPENAI_FILTER_MODEL) {
    source.OPENAI_FILTER_MODEL = "gpt-4o-mini";
  }

  if (!source.OPENAI_DRAFT_MODEL) {
    source.OPENAI_DRAFT_MODEL = "gpt-4o";
  }

  if (!source.DRY_RUN) {
    source.DRY_RUN = "true";
  }

  if (!source.AGENT_ENABLED) {
    source.AGENT_ENABLED = "true";
  }

  if (!source.DAILY_EMAIL_LIMIT) {
    source.DAILY_EMAIL_LIMIT = "100";
  }

  if (!source.ENABLE_PATTERN_GUESSING) {
    source.ENABLE_PATTERN_GUESSING = "false";
  }

  if (!source.ALLOW_LOW_CONFIDENCE_SEND) {
    source.ALLOW_LOW_CONFIDENCE_SEND = "false";
  }

  // The user may have named the secret either GROK_API_KEY (standard) or
  // GROK_API_key (mixed case). Accept either.
  if (!source.GROK_API_KEY && source.GROK_API_key) {
    source.GROK_API_KEY = source.GROK_API_key;
  }

  if (!source.GROK_MODEL) {
    // grok-4-fast-reasoning gives noticeably better hit rates on
    // ambiguous company names than the non-reasoning variant, and the
    // small latency penalty is fine because we now look up one company
    // per HTTP request.
    source.GROK_MODEL = "grok-4-fast-reasoning";
  }
}

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_FILTER_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_DRAFT_MODEL: z.string().default("gpt-4o"),
  GMAIL_USER: z.string().email(),
  GMAIL_APP_PASSWORD: z.string().min(16),
  CRON_SECRET: z.string().min(8),
  ADMIN_TOKEN: z.string().min(8),
  BUSINESS_NAME: z.string().min(1),
  BUSINESS_ADDRESS: z.string().min(1),
  CONTACT_EMAIL: z.string().email(),
  UNSUBSCRIBE_MAILTO: z.string().email(),
  UNSUBSCRIBE_URL: z.string().url(),
  DRY_RUN: z
    .string()
    .optional()
    .default("true")
    .transform((v) => v === "true"),
  AGENT_ENABLED: z
    .string()
    .optional()
    .default("true")
    .transform((v) => v === "true"),
  DAILY_EMAIL_LIMIT: z.coerce.number().int().positive().default(100),
  ENABLE_PATTERN_GUESSING: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v === "true"),
  ALLOW_LOW_CONFIDENCE_SEND: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v === "true"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  GROK_API_KEY: z.string().min(1).optional(),
  GROK_MODEL: z.string().default("grok-4-fast-reasoning"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  normalizeEnv();

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    if (process.env.SKIP_ENV_VALIDATION === "true") {
      // Build-time fallback: write placeholder values directly into process.env
      // so the second parse succeeds. These are NEVER used at runtime — Vercel
      // injects real env vars and loadEnv() runs again per cold start.
      const placeholders: Record<string, string> = {
        DATABASE_URL:
          resolveDatabaseUrl(process.env) || "postgres://local/build",
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "sk-build-placeholder",
        GMAIL_USER:
          process.env.GMAIL_USER ??
          process.env.CONTACT_EMAIL ??
          "build@example.com",
        GMAIL_APP_PASSWORD:
          process.env.GMAIL_APP_PASSWORD ?? "abcdefghijklmnop",
        CRON_SECRET: process.env.CRON_SECRET ?? "build-cron-secret-12345678",
        ADMIN_TOKEN: process.env.ADMIN_TOKEN ?? "build-admin-token-12345678",
        BUSINESS_NAME: process.env.BUSINESS_NAME ?? "TalentBridge",
        BUSINESS_ADDRESS:
          process.env.BUSINESS_ADDRESS ?? "123 Build Street",
        CONTACT_EMAIL:
          process.env.CONTACT_EMAIL ?? "contact@talentbridge.example",
        UNSUBSCRIBE_MAILTO:
          process.env.UNSUBSCRIBE_MAILTO ?? "unsubscribe@talentbridge.example",
        UNSUBSCRIBE_URL:
          process.env.UNSUBSCRIBE_URL ??
          "https://talentbridge.example/unsubscribe",
      };
      for (const [k, v] of Object.entries(placeholders)) {
        if (!process.env[k]) process.env[k] = v;
      }
      normalizeEnv();
      return envSchema.parse(process.env);
    }
    const formatted = parsed.error.flatten().fieldErrors;
    console.error("Invalid environment variables:", formatted);
    throw new Error(
      `Missing or invalid env vars: ${Object.keys(formatted).join(", ")}`
    );
  }
  return parsed.data;
}

export const env: Env = loadEnv();

export const CRON_EMAIL_LIMIT = 30;
export const CRON_POSTING_LIMIT = 150;
export const DOMAIN_RATE_LIMIT_DAYS = 30;
// Larger batches = fewer LLM round-trips; the JSON-mode response fits 12 easily.
export const FILTER_BATCH_SIZE = 12;
// How many filter / discovery operations to fan out at once. Vercel Hobby has
// a 60s function ceiling, so sequential per-posting work blows the budget on
// 100+ scraped jobs. Parallelism keeps the whole pipeline under the limit.
export const LLM_FILTER_CONCURRENCY = 3;
export const CONTACT_DISCOVERY_CONCURRENCY = 4;
