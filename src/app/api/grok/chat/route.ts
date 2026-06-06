import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export const maxDuration = 30;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface Body {
  messages?: ChatMessage[];
}

/**
 * Bare-bones xAI chat endpoint. No system prompt, no tools — just relays
 * the conversation to Grok and returns the reply. Used by the chat
 * window under the Outreach tab.
 *
 * Public — no admin token needed because the only thing it does is
 * forward to xAI using the server's own GROK_API_KEY. Keep an eye on
 * usage if you make this exposed.
 */
export async function POST(request: Request) {
  if (!env.GROK_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "GROK_API_KEY is not configured on the server." },
      { status: 503 }
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) {
    return NextResponse.json(
      { ok: false, error: "messages: [] required" },
      { status: 400 }
    );
  }

  // Trim noise and cap message count to avoid runaway costs.
  const trimmed = messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content)
    .slice(-20)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4_000) }));

  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GROK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.GROK_MODEL,
        messages: trimmed,
        max_tokens: 800,
      }),
      signal: AbortSignal.timeout(25_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        {
          ok: false,
          error: `xAI HTTP ${res.status}`,
          detail: text.slice(0, 300),
        },
        { status: 200 }
      );
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const reply = json.choices?.[0]?.message?.content ?? "";
    return NextResponse.json({ ok: true, reply });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 200 }
    );
  }
}
