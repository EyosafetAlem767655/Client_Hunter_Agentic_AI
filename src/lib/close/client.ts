import { env } from "@/lib/env";

const BASE = "https://api.close.com/api/v1";

export function isCloseConfigured(): boolean {
  return Boolean(env.CLOSE_API_KEY);
}

function authHeader(): string {
  const key = env.CLOSE_API_KEY?.trim();
  if (!key) throw new Error("CLOSE_API_KEY not configured");
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

async function closeFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Close API ${res.status}: ${text.slice(0, 300)}`);
  }
  if (method === "DELETE") return undefined as T;
  return res.json() as Promise<T>;
}

export const closeGet    = <T>(path: string) => closeFetch<T>("GET", path);
export const closePost   = <T>(path: string, body: unknown) => closeFetch<T>("POST", path, body);
export const closePut    = <T>(path: string, body: unknown) => closeFetch<T>("PUT", path, body);
export const closeDelete = (path: string) => closeFetch<void>("DELETE", path);
