import OpenAI from "openai";
import { env } from "@/lib/env";
import { sleep, withTimeout } from "@/lib/utils";

const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

export function createOpenAIClient(): OpenAI {
  return new OpenAI({ apiKey: env.OPENAI_API_KEY });
}

export async function callOpenAIJson<T>(params: {
  model: string;
  system: string;
  user: string;
  jsonSchema: Record<string, unknown>;
}): Promise<T> {
  const client = createOpenAIClient();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
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
        TIMEOUT_MS,
        "OpenAI request"
      );

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error("Empty OpenAI response");
      }
      return JSON.parse(content) as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < MAX_RETRIES - 1) {
        await sleep(2 ** attempt * 500);
      }
    }
  }

  throw lastError ?? new Error("OpenAI request failed");
}
