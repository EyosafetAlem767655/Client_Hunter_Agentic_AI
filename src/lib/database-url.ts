/**
 * Resolve Postgres URL from Vercel + Neon integration env vars.
 * Prefers pooled URLs for serverless (Neon HTTP driver).
 */
export function resolveDatabaseUrl(
  source: Record<string, string | undefined> = process.env
): string {
  const pooled = [
    source.DATABASE_URL,
    source.POSTGRES_URL,
    source.POSTGRES_PRISMA_URL,
  ].find((url) => url && (url.includes("pooler") || url.includes("prisma")));

  if (pooled) return pooled;

  return (
    source.DATABASE_URL ??
    source.POSTGRES_URL ??
    source.POSTGRES_PRISMA_URL ??
    source.POSTGRES_URL_NON_POOLING ??
    source.DATABASE_URL_UNPOOLED ??
    source.POSTGRES_URL_NO_SSL ??
    ""
  );
}
