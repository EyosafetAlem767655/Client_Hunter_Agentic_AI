import { env } from "@/lib/env";
import { sleep, withTimeout } from "@/lib/utils";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const TIMEOUT_MS = 40_000;
const MAX_RETRIES = 2;

interface AnthropicContentBlock {
  type?: string;
  text?: string;
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
}

export function isAnthropicConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

/**
 * Call the Anthropic Messages API and return the concatenated text output.
 * Uses REST directly (no SDK dependency), mirroring the retry/timeout shape of
 * the OpenAI client in llm/client.ts.
 */
export async function callClaudeText(params: {
  user: string;
  system?: string;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
}): Promise<string> {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const timeoutMs = params.timeoutMs ?? TIMEOUT_MS;
  const maxRetries = params.maxRetries ?? MAX_RETRIES;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await withTimeout(
        fetch(ANTHROPIC_URL, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: params.model ?? env.CLAUDE_MODEL,
            max_tokens: params.maxTokens ?? 700,
            ...(params.system ? { system: params.system } : {}),
            messages: [{ role: "user", content: params.user }],
          }),
        }),
        timeoutMs,
        "Anthropic request"
      );

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 300)}`);
      }

      const data = (await res.json()) as AnthropicResponse;
      return (data.content ?? [])
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join(" ")
        .trim();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries - 1) await sleep(2 ** attempt * 500);
    }
  }

  throw lastError ?? new Error("Anthropic request failed");
}
