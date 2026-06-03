import { env } from "@/lib/env";

export function verifyCronAuth(request: Request): boolean {
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${env.CRON_SECRET}`;
}

export function verifyAdminAuth(request: Request): boolean {
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${env.ADMIN_TOKEN}`;
}
