import { describe, expect, it } from "vitest";
import { resolveDatabaseUrl } from "@/lib/database-url";

describe("resolveDatabaseUrl", () => {
  it("prefers pooled DATABASE_URL", () => {
    const url = resolveDatabaseUrl({
      DATABASE_URL:
        "postgres://u:p@ep-xxx-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require",
      POSTGRES_URL: "postgres://u:p@ep-xxx.us-east-1.aws.neon.tech/neondb",
    });
    expect(url).toContain("pooler");
  });

  it("falls back to POSTGRES_URL", () => {
    const url = resolveDatabaseUrl({
      POSTGRES_URL: "postgres://u:p@host/db",
    });
    expect(url).toBe("postgres://u:p@host/db");
  });

  it("returns empty when nothing set", () => {
    expect(resolveDatabaseUrl({})).toBe("");
  });
});
