"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

/**
 * A no-frills chat window that proxies to /api/grok/chat. No system
 * prompt — Grok answers however it wants. Lives under the Outreach
 * tab just for fun.
 */
export function GrokChat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, pending]);

  async function send() {
    const text = input.trim();
    if (!text || pending) return;
    setError(null);
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setPending(true);
    try {
      const res = await fetch("/api/grok/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        reply?: string;
        error?: string;
      };
      if (!data.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setMessages((m) => [
        ...m,
        { role: "assistant", content: data.reply ?? "" },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="glass-card">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>Chat with Grok</CardTitle>
        <span className="text-xs text-muted-foreground">For fun.</span>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          ref={scrollRef}
          className="max-h-80 min-h-32 space-y-3 overflow-y-auto rounded-lg border border-border/30 bg-background/40 p-3 text-sm"
        >
          {messages.length === 0 && (
            <p className="text-center text-xs text-muted-foreground">
              Say hi. Grok&apos;s listening.
            </p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${
                m.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 leading-relaxed ${
                  m.role === "user"
                    ? "bg-primary/85 text-primary-foreground"
                    : "border border-border/40 bg-card/60"
                }`}
              >
                {m.content || (m.role === "assistant" ? "…" : "")}
              </div>
            </div>
          ))}
          {pending && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-border/40 bg-card/60 px-3 py-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
        </div>
        {error && (
          <p className="text-xs text-red-400">
            {error.includes("503")
              ? "GROK_API_KEY not set on the server."
              : error}
          </p>
        )}
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Type a message…"
            className="flex-1 rounded-md border border-input bg-background/60 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
            disabled={pending}
            autoComplete="off"
          />
          <Button onClick={send} disabled={!input.trim() || pending}>
            <Send className="h-4 w-4" />
            Send
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
