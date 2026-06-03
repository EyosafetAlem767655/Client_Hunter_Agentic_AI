import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function jitterMs(min = 1000, max = 2000): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = "operation"
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

export function maskSecret(value: string, visible = 4): string {
  if (value.length <= visible) return "****";
  return `${value.slice(0, Math.min(3, visible))}...${value.slice(-visible)}`;
}

export function extractDomain(email: string): string {
  const parts = email.split("@");
  return parts[1]?.toLowerCase() ?? "";
}
