import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function DbErrorBanner({ message }: { message: string }) {
  return (
    <Card className="border-amber-500/50 bg-amber-500/10">
      <CardHeader>
        <CardTitle className="text-amber-400">Database setup required</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>{message}</p>
        <p>
          On Vercel, redeploy after confirming{" "}
          <code className="rounded bg-muted px-1">DATABASE_URL</code> or{" "}
          <code className="rounded bg-muted px-1">POSTGRES_URL</code> is set.
          Schema is pushed automatically during build.
        </p>
        <p>
          Check{" "}
          <Link href="/api/health" className="text-primary underline">
            /api/health
          </Link>{" "}
          for connection status.
        </p>
      </CardContent>
    </Card>
  );
}
