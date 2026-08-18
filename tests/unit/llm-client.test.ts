import { beforeEach, describe, expect, it, vi } from "vitest";

const genaiMocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { generateContent: genaiMocks.generateContent },
  })),
}));

import { callGeminiJson } from "@/lib/llm/client";

const request = {
  model: "gemini-3.5-flash-lite",
  system: "Return a result",
  user: "Hello",
  jsonSchema: {
    type: "object",
    properties: { ok: { type: "boolean" } },
    required: ["ok"],
  },
};

describe("Gemini JSON client", () => {
  beforeEach(() => {
    genaiMocks.generateContent.mockReset();
  });

  it("sends prompts and a structured-output schema", async () => {
    genaiMocks.generateContent.mockResolvedValue({ text: '{"ok":true}' });

    await expect(callGeminiJson<{ ok: boolean }>(request)).resolves.toEqual({
      ok: true,
    });
    expect(genaiMocks.generateContent).toHaveBeenCalledWith({
      model: request.model,
      contents: request.user,
      config: {
        systemInstruction: request.system,
        responseMimeType: "application/json",
        responseJsonSchema: request.jsonSchema,
      },
    });
  });

  it.each([
    [{ text: "" }, "Empty Gemini response"],
    [{ text: "not json" }, "Unexpected token"],
  ])("rejects invalid responses", async (response, message) => {
    genaiMocks.generateContent.mockResolvedValue(response);
    await expect(
      callGeminiJson({ ...request, maxRetries: 1 })
    ).rejects.toThrow(message);
  });

  it("retries transient failures", async () => {
    genaiMocks.generateContent
      .mockRejectedValueOnce(new Error("rate limited"))
      .mockResolvedValueOnce({ text: '{"ok":true}' });

    await expect(
      callGeminiJson<{ ok: boolean }>({ ...request, maxRetries: 2 })
    ).resolves.toEqual({ ok: true });
    expect(genaiMocks.generateContent).toHaveBeenCalledTimes(2);
  });

  it("times out a stalled request", async () => {
    genaiMocks.generateContent.mockReturnValue(new Promise(() => undefined));
    await expect(
      callGeminiJson({ ...request, timeoutMs: 1, maxRetries: 1 })
    ).rejects.toThrow("Gemini request timed out");
  });
});
