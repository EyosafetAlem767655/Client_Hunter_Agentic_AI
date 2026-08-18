import "@testing-library/jest-dom/vitest";

process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://test:test@localhost:5432/test";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "gemini-test-key";
process.env.GEMINI_MODEL = "gemini-3.5-flash-lite";
process.env.GMAIL_USER = "test@example.com";
process.env.GMAIL_APP_PASSWORD = "abcdefghijklmnop";
process.env.CRON_SECRET = "test-cron-secret";
process.env.ADMIN_TOKEN = "test-admin-token";
process.env.BUSINESS_NAME = "TalentBridge";
process.env.BUSINESS_ADDRESS = "123 Test St";
process.env.CONTACT_EMAIL = "contact@talentbridge.example";
process.env.UNSUBSCRIBE_MAILTO = "unsubscribe@talentbridge.example";
process.env.UNSUBSCRIBE_URL = "https://talentbridge.example/unsubscribe";
process.env.DRY_RUN = "true";
process.env.AGENT_ENABLED = "true";
process.env.DAILY_EMAIL_LIMIT = "100";
process.env.ENABLE_PATTERN_GUESSING = "false";
process.env.ALLOW_LOW_CONFIDENCE_SEND = "false";
