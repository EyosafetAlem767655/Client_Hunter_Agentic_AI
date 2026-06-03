import { describe, expect, it, vi, beforeEach } from "vitest";

const getLlmCache = vi.fn();
const setLlmCache = vi.fn();

vi.mock("@/lib/db/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/queries")>();
  return {
    ...actual,
    getLlmCache,
    setLlmCache,
  };
});

describe("memory LLM cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads and writes cache keys", async () => {
    getLlmCache.mockResolvedValue({ response: { ok: true } });
    const { memory } = await import("@/lib/agent/memory");
    const hit = await memory.getCachedLlm("gpt-4o-mini", "input-hash");
    expect(hit).toEqual({ ok: true });

    await memory.setCachedLlm("gpt-4o-mini", "input-hash", { ok: true });
    expect(setLlmCache).toHaveBeenCalled();
  });
});
