import OpenAI from "openai";
import { env } from "@/lib/env";
import { sleep, withTimeout } from "@/lib/utils";

const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

/**
 * Build an OpenAI client with a per-call timeout. We override the SDK's
 * default 600 s timeout because Vercel functions cap at 60 s — without
 * this, a stuck connection can hang the whole function and 504. The
 * outer `withTimeout` belt-and-braces protects against the SDK ignoring
 * its own timeout (which it has done historically on certain stream
 * cancellation paths).
 */
export function createOpenAIClient(timeoutMs: number = TIMEOUT_MS): OpenAI {
  return new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    timeout: timeoutMs,
    // SDK-level retries are 0 here because we drive retries explicitly in
    // `callOpenAIJson` below with our own backoff and per-call timeout.
    maxRetries: 0,
  });
}

export async function callOpenAIJson<T>(params: {
  model: string;
  system: string;
  user: string;
  jsonSchema: Record<string, unknown>;
  timeoutMs?: number;
  maxRetries?: number;
}): Promise<T> {
  const timeoutMs = params.timeoutMs ?? TIMEOUT_MS;
  const maxRetries = params.maxRetries ?? MAX_RETRIES;
  const client = createOpenAIClient(timeoutMs);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const completion = await withTimeout(
        client.chat.completions.create({
          model: params.model,
          messages: [
            { role: "system", content: params.system },
            { role: "user", content: params.user },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "response",
              schema: params.jsonSchema as Record<string, unknown>,
              strict: true,
            },
          },
        }),
        timeoutMs,
        "OpenAI request"
      );

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error("Empty OpenAI response");
      }
      return JSON.parse(content) as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries - 1) {
        await sleep(2 ** attempt * 500);
      }
    }
  }

  throw lastError ?? new Error("OpenAI request failed");
}
