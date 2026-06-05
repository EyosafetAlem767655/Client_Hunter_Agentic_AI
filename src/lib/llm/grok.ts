import { env } from "@/lib/env";

/**
 * Thin wrapper around xAI's chat-completions endpoint, scoped to the one
 * thing we need: a JSON answer backed by live web search.
 *
 * xAI is OpenAI-API-compatible (https://api.x.ai/v1) but adds a
 * `search_parameters` field that, when set, lets the model run web
 * searches as part of producing its answer. That's exactly what we want
 * for finding the right `careers@` / `hiring@` email of a given company:
 * Grok searches the open web, picks the most credible address, and
 * returns it in the JSON shape we ask for.
 *
 * Reference (verified against xAI docs as of 2026-06):
 *   POST https://api.x.ai/v1/chat/completions
 *   { model, messages, response_format, search_parameters: { mode, ... } }
 */

const ENDPOINT = "https://api.x.ai/v1/chat/completions";

export interface GrokSearchRequest {
  system: string;
  user: string;
  /** "auto" lets Grok decide; "on" forces a search. */
  searchMode?: "auto" | "on" | "off";
  /** Cap citations & cost; ~5 sources is usually enough for a contact lookup. */
  maxSearchResults?: number;
  /** Restrict to allowed sources (e.g. "web", "x", "news"). */
  sources?: Array<{ type: "web" | "news" | "x" } & Record<string, unknown>>;
  /** Tell Grok we want JSON back. */
  jsonSchema?: Record<string, unknown>;
  /** Override the model, otherwise env.GROK_MODEL. */
  model?: string;
  /** Hard wall on total round-trip time in ms; defaults to 25 s. */
  timeoutMs?: number;
}

export interface GrokResponse<T> {
  data: T | null;
  raw: string;
  /** URLs Grok cited; useful to log + audit which page a contact came from. */
  citations: string[];
}

export function isGrokConfigured(): boolean {
  return Boolean(env.GROK_API_KEY);
}

export async function callGrokJson<T>(
  req: GrokSearchRequest
): Promise<GrokResponse<T>> {
  if (!env.GROK_API_KEY) {
    throw new Error("GROK_API_KEY is not set");
  }

  const body: Record<string, unknown> = {
    model: req.model ?? env.GROK_MODEL,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
    // Force JSON output. xAI honours OpenAI's response_format shape.
    response_format: req.jsonSchema
      ? {
          type: "json_schema",
          json_schema: {
            name: "result",
            schema: req.jsonSchema,
            strict: true,
          },
        }
      : { type: "json_object" },
    search_parameters: {
      mode: req.searchMode ?? "auto",
      return_citations: true,
      max_search_results: req.maxSearchResults ?? 5,
      ...(req.sources ? { sources: req.sources } : {}),
    },
    // Keep the answer short — we only need a JSON blob with a few fields.
    max_tokens: 600,
    temperature: 0.1,
  };

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("Grok request timeout")),
    req.timeoutMs ?? 25_000
  );

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GROK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Grok HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    citations?: string[];
  };
  const content = json.choices?.[0]?.message?.content ?? "";
  let parsed: T | null = null;
  try {
    parsed = JSON.parse(content) as T;
  } catch {
    parsed = null;
  }
  return {
    data: parsed,
    raw: content,
    citations: Array.isArray(json.citations) ? json.citations : [],
  };
}
