import { afterEach, describe, expect, it, vi } from "vitest";
import { callGeminiInteraction, GeminiCallError } from "./client";

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    }),
  );
}

describe("callGeminiInteraction", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("extrai o texto via output_text quando presente", async () => {
    mockFetchOnce({ output_text: "  resposta aqui  " });
    expect(await callGeminiInteraction("key", [{ type: "text", text: "oi" }])).toBe(
      "resposta aqui",
    );
  });

  it("extrai o texto navegando por steps[].content[] quando output_text não existe", async () => {
    mockFetchOnce({
      steps: [
        { type: "model_output", content: [{ type: "text", text: "parte 1" }] },
        { type: "model_output", content: [{ type: "text", text: "parte 2" }] },
      ],
    });
    expect(await callGeminiInteraction("key", [{ type: "text", text: "oi" }])).toBe(
      "parte 1 parte 2",
    );
  });

  it("lança GeminiCallError quando a resposta HTTP não é ok", async () => {
    mockFetchOnce({ error: "invalid key" }, false, 401);
    await expect(callGeminiInteraction("key", [{ type: "text", text: "oi" }])).rejects.toThrow(
      GeminiCallError,
    );
  });

  it("lança GeminiCallError quando não consegue extrair texto de nenhum formato conhecido", async () => {
    mockFetchOnce({ status: "completed", steps: [] });
    await expect(callGeminiInteraction("key", [{ type: "text", text: "oi" }])).rejects.toThrow(
      GeminiCallError,
    );
  });

  it("envia o payload no formato esperado pela Interactions API", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ output_text: "ok" }),
      text: () => Promise.resolve(""),
    });
    vi.stubGlobal("fetch", fetchMock);

    await callGeminiInteraction("minha-chave", [
      { type: "audio", data: "QUJD", mime_type: "audio/webm" },
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-goog-api-key": "minha-chave" }),
      }),
    );
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.input).toEqual([{ type: "audio", data: "QUJD", mime_type: "audio/webm" }]);
  });
});
