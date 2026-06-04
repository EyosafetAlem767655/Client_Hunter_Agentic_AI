import { defineConfig } from "drizzle-kit";
import { resolveDatabaseUrl } from "./src/lib/database-url";

const url = resolveDatabaseUrl();
if (url) {
  process.env.DATABASE_URL = url;
}

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: url || "postgres://localhost:5432/placeholder",
  },
});
