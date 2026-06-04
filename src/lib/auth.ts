import { env } from "@/lib/env";

function bearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization")?.trim();
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length).trim();
}

/** Vercel sets x-vercel-cron: 1 on scheduled invocations. */
function isVercelCron(request: Request): boolean {
  return (
    process.env.VERCEL === "1" &&
    request.headers.get("x-vercel-cron") === "1"
  );
}

export function verifyCronAuth(request: Request): boolean {
  if (isVercelCron(request)) return true;

  const token = bearerToken(request);
  if (!token) return false;

  return token === env.CRON_SECRET.trim();
}

export function verifyAdminAuth(request: Request): boolean {
  const token = bearerToken(request);
  if (!token) return false;

  return token === env.ADMIN_TOKEN.trim();
}

/** Manual pipeline triggers accept admin or cron secret. */
export function verifyManualAuth(request: Request): boolean {
  return verifyAdminAuth(request) || verifyCronAuth(request);
}

export function verifyIngestAuth(request: Request): boolean {
  return verifyManualAuth(request);
}
