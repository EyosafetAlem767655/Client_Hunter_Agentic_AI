import { z } from "zod";

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
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    if (process.env.SKIP_ENV_VALIDATION === "true") {
      return envSchema.parse({
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL ?? "postgres://local/build",
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "sk-build-placeholder",
        GMAIL_USER: process.env.GMAIL_USER ?? "build@example.com",
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
          process.env.UNSUBSCRIBE_URL ?? "https://talentbridge.example/unsubscribe",
      });
    }
    const formatted = parsed.error.flatten().fieldErrors;
    throw new Error(
      `Invalid environment variables: ${JSON.stringify(formatted)}`
    );
  }
  return parsed.data;
}

export const env: Env = loadEnv();

export const CRON_EMAIL_LIMIT = 30;
export const CRON_POSTING_LIMIT = 50;
export const DOMAIN_RATE_LIMIT_DAYS = 30;
export const FILTER_BATCH_SIZE = 5;
