import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { resolveDatabaseUrl } from "@/lib/database-url";
import * as schema from "./schema";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!_db) {
    const url = resolveDatabaseUrl();
    if (!url) {
      throw new Error(
        "No database URL found. Set DATABASE_URL or POSTGRES_URL (Neon/Vercel integration)."
      );
    }
    const client = neon(url);
    _db = drizzle(client, { schema });
  }
  return _db;
}

export async function healthCheck(): Promise<boolean> {
  try {
    const db = getDb();
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

export { schema };
