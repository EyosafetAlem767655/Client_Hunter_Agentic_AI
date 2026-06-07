import { env } from "@/lib/env";

/**
 * Thin wrapper around xAI's Responses API web search flow.
 *
 * The contact-discovery path needs Grok to do one thing well: search the web
 * for a company's Contact us URL. We intentionally do not force JSON output
 * here because the Grok website behavior the app is matching is a simple web
 * search prompt, with URLs recovered from response text and citations.
 */

const ENDPOINT = "https://api.x.ai/v1/responses";

export interface GrokSearchRequest {
  system: string;
  user: string;
  /** Override the model, otherwise env.GROK_MODEL. */
  model?: string;
  /** Hard wall on total round-trip time in ms; defaults to 25 s. */
  timeoutMs?: number;
}

export interface GrokResponse<T> {
  data: T | null;
  raw: string;
  /** URLs Grok encountered during web search. */
  citations: string[];
}

interface XaiResponsesApiResponse {
  output_text?: string;
  output?: Array<{
    type?: string;
    text?: string;
    content?: string | Array<{
      type?: string;
      text?: string;
      annotations?: Array<{
        type?: string;
        url?: string;
        url_citation?: { url?: string };
      }>;
    }>;
  }>;
  citations?: unknown;
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
    input: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
    tools: [{ type: "web_search" }],
    max_output_tokens: 600,
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

  const json = (await res.json()) as XaiResponsesApiResponse;
  const raw = extractResponseText(json);
  let parsed: T | null = null;
  try {
    parsed = JSON.parse(raw) as T;
  } catch {
    parsed = null;
  }

  return {
    data: parsed,
    raw,
    citations: extractCitations(json),
  };
}

function extractResponseText(json: XaiResponsesApiResponse): string {
  const chunks: string[] = [];
  if (typeof json.output_text === "string" && json.output_text.trim()) {
    chunks.push(json.output_text);
  }

  for (const item of json.output ?? []) {
    if (typeof item.text === "string" && item.text.trim()) {
      chunks.push(item.text);
    }
    if (typeof item.content === "string" && item.content.trim()) {
      chunks.push(item.content);
      continue;
    }
    if (!Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (typeof content.text === "string" && content.text.trim()) {
        chunks.push(content.text);
      }
    }
  }

  return Array.from(new Set(chunks)).join("\n");
}

function extractCitations(json: XaiResponsesApiResponse): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (url: unknown) => {
    if (typeof url !== "string") return;
    if (!url.startsWith("http")) return;
    if (seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };

  if (Array.isArray(json.citations)) {
    for (const citation of json.citations) push(citation);
  }

  for (const item of json.output ?? []) {
    if (!Array.isArray(item.content)) continue;
    for (const content of item.content) {
      for (const annotation of content.annotations ?? []) {
        push(annotation.url);
        push(annotation.url_citation?.url);
      }
    }
  }

  return out;
}
