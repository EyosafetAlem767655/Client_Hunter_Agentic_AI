import { execSync } from "node:child_process";

function resolveDatabaseUrl(env) {
  const pooled = [env.DATABASE_URL, env.POSTGRES_URL, env.POSTGRES_PRISMA_URL].find(
    (url) => url && (url.includes("pooler") || url.includes("prisma"))
  );
  if (pooled) return pooled;
  return (
    env.DATABASE_URL ??
    env.POSTGRES_URL ??
    env.POSTGRES_PRISMA_URL ??
    env.POSTGRES_URL_NON_POOLING ??
    env.DATABASE_URL_UNPOOLED ??
    ""
  );
}

const dbUrl = resolveDatabaseUrl(process.env);

if (dbUrl) {
  console.log("Pushing database schema...");
  try {
    execSync("npx drizzle-kit push --force", {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: dbUrl },
    });
    console.log("Schema push complete.");
  } catch (error) {
    // On Vercel production builds, schema push must succeed
    if (process.env.VERCEL === "1") {
      console.error("Schema push failed on Vercel — check DATABASE_URL / Neon connection.");
      throw error;
    }
    console.warn("Schema push skipped (no reachable database in this environment).");
  }
} else {
  console.warn("No database URL — skipping drizzle-kit push");
}

execSync("npx next build", {
  stdio: "inherit",
  env: { ...process.env, SKIP_ENV_VALIDATION: "true" },
});
