import { spawn } from "node:child_process";
import path from "node:path";
import { env } from "@/lib/env";

interface JobDescResult {
  ok?: boolean;
  description?: string;
  engine?: string;
  error?: string;
}

function appBaseUrl(): string {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

/** Local dev: run the Python scraper directly (the /api/py endpoint is Vercel-only). */
function runSubprocess(url: string): Promise<JobDescResult | null> {
  const scriptPath = path.join(process.cwd(), "api", "py", "scrape_jobdesc.py");
  return new Promise((resolve) => {
    let stdout = "";
    let done = false;
    const finish = (r: JobDescResult | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    const proc = spawn("python", [scriptPath, url], { cwd: process.cwd(), env: { ...process.env } });
    const timer = setTimeout(() => { proc.kill(); finish(null); }, 45_000);
    proc.stdout.on("data", (c: Buffer) => { stdout += c.toString(); });
    proc.on("close", () => {
      try { finish(JSON.parse(stdout) as JobDescResult); } catch { finish(null); }
    });
    proc.on("error", () => finish(null));
  });
}

/** Vercel: call the Python serverless function over HTTP. */
async function callVercel(url: string): Promise<JobDescResult | null> {
  const secret = env.CRON_SECRET || env.ADMIN_TOKEN || "";
  try {
    const res = await fetch(`${appBaseUrl()}/api/py/scrape_jobdesc`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(50_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as JobDescResult;
  } catch {
    return null;
  }
}

/**
 * Pull the full job description for a single posting URL using the Python
 * scraper (Playwright → curl_cffi → requests cascade + DOM extraction).
 * Returns the description text, or null when nothing substantial was found.
 */
export async function fetchJobDescriptionViaPython(url: string): Promise<string | null> {
  if (!/^https?:\/\//.test(url)) return null;
  const result =
    process.env.VERCEL === "1" ? await callVercel(url) : await runSubprocess(url);
  if (result?.ok && result.description && result.description.length > 150) {
    return result.description;
  }
  return null;
}
