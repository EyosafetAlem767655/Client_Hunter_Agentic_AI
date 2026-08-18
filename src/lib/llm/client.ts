import { GoogleGenAI } from "@google/genai";
import { env } from "@/lib/env";
import { sleep, withTimeout } from "@/lib/utils";

const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

/** Build a Gemini client using the server-only API key. */
export function createGeminiClient(): GoogleGenAI {
  return new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
}

export async function callGeminiJson<T>(params: {
  model: string;
  system: string;
  user: string;
  jsonSchema: Record<string, unknown>;
  timeoutMs?: number;
  maxRetries?: number;
}): Promise<T> {
  const timeoutMs = params.timeoutMs ?? TIMEOUT_MS;
  const maxRetries = params.maxRetries ?? MAX_RETRIES;
  const client = createGeminiClient();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await withTimeout(
        client.models.generateContent({
          model: params.model,
          contents: params.user,
          config: {
            systemInstruction: params.system,
            responseMimeType: "application/json",
            responseJsonSchema: params.jsonSchema,
          },
        }),
        timeoutMs,
        "Gemini request"
      );

      const content = response.text;
      if (!content) throw new Error("Empty Gemini response");
      return JSON.parse(content) as T;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries - 1) await sleep(2 ** attempt * 500);
    }
  }

  throw lastError ?? new Error("Gemini request failed");
}
