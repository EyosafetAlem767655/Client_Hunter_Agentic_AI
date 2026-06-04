import { spawn } from "node:child_process";
import path from "node:path";
import { env } from "@/lib/env";
import type { RawPosting } from "@/types";

export interface PythonScrapeResult {
  postings: RawPosting[];
  scraped: number;
  sources: Array<{ source: string; ok: boolean; count?: number; error?: string }>;
}

function appBaseUrl(): string {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

function normalizePosting(raw: Record<string, unknown>): RawPosting {
  let postedAt: Date | null = null;
  const posted = raw.postedAt;
  if (typeof posted === "string" && posted) {
    const d = new Date(posted);
    postedAt = Number.isNaN(d.getTime()) ? null : d;
  } else if (typeof posted === "number") {
    postedAt = new Date(posted * 1000);
  }

  return {
    source: raw.source as RawPosting["source"],
    externalId: String(raw.externalId ?? ""),
    url: String(raw.url ?? ""),
    title: String(raw.title ?? ""),
    company: String(raw.company ?? ""),
    location: String(raw.location ?? "Remote"),
    description: String(raw.description ?? ""),
    postedAt,
    raw: (raw.raw as Record<string, unknown>) ?? raw,
  };
}

async function fetchPythonOnVercel(limit: number): Promise<PythonScrapeResult> {
  const url = `${appBaseUrl()}/api/py/scrape?limit=${limit}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.CRON_SECRET}`,
    },
    signal: AbortSignal.timeout(55_000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Python scraper HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    postings?: Record<string, unknown>[];
    scraped?: number;
    sources?: PythonScrapeResult["sources"];
  };

  return {
    postings: (data.postings ?? []).map(normalizePosting),
    scraped: data.scraped ?? 0,
    sources: data.sources ?? [],
  };
}

async function runPythonSubprocess(limit: number): Promise<PythonScrapeResult> {
  const script = path.join(process.cwd(), "scraper", "run.py");
  const contact = env.CONTACT_EMAIL;

  return new Promise((resolve, reject) => {
    const proc = spawn("python", [script, "--limit", String(limit), "--contact-email", contact], {
      cwd: process.cwd(),
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Python scraper exited ${code}: ${stderr.slice(0, 300)}`));
        return;
      }
      try {
        const data = JSON.parse(stdout) as {
          postings?: Record<string, unknown>[];
          scraped?: number;
          sources?: PythonScrapeResult["sources"];
        };
        resolve({
          postings: (data.postings ?? []).map(normalizePosting),
          scraped: data.scraped ?? 0,
          sources: data.sources ?? [],
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}

export async function runPythonScrapers(limit: number): Promise<PythonScrapeResult> {
  if (process.env.VERCEL === "1") {
    return fetchPythonOnVercel(limit);
  }

  try {
    return await runPythonSubprocess(limit);
  } catch (subprocessError) {
    if (process.env.NODE_ENV === "development") {
      try {
        return await fetchPythonOnVercel(limit);
      } catch {
        throw subprocessError;
      }
    }
    throw subprocessError;
  }
}

export function parseIngestPostings(raw: unknown): RawPosting[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => normalizePosting(item as Record<string, unknown>));
}
