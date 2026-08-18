import { describe, expect, it, vi, beforeEach } from "vitest";

const { getLlmCache, setLlmCache } = vi.hoisted(() => ({
  getLlmCache: vi.fn(),
  setLlmCache: vi.fn(),
}));

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

  it(
    "reads and writes cache keys",
    async () => {
      getLlmCache.mockResolvedValue({ response: { ok: true } });
      const { memory } = await import("@/lib/agent/memory");
      const hit = await memory.getCachedLlm("gemini-3.5-flash-lite", "input-hash");
      expect(hit).toEqual({ ok: true });

      await memory.setCachedLlm("gemini-3.5-flash-lite", "input-hash", { ok: true });
      expect(setLlmCache).toHaveBeenCalled();
    },
    15_000
  );
});
