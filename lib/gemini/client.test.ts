import { afterEach, describe, expect, it, vi } from "vitest";
import { callGeminiInteraction, GeminiCallError, parseErrorMessage } from "./client";

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
    expect(await callGeminiInteraction("key", [{ type: "text", text: "oi" }])).toEqual({
      text: "resposta aqui",
      modelUsed: "gemini-3.8-flash",
    });
  });

  it("extrai o texto navegando por steps[].content[] quando output_text não existe", async () => {
    mockFetchOnce({
      steps: [
        { type: "model_output", content: [{ type: "text", text: "parte 1" }] },
        { type: "model_output", content: [{ type: "text", text: "parte 2" }] },
      ],
    });
    expect(await callGeminiInteraction("key", [{ type: "text", text: "oi" }])).toEqual({
      text: "parte 1 parte 2",
      modelUsed: "gemini-3.8-flash",
    });
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

  it("faz fallback para o próximo modelo quando o primeiro falha com alta demanda (500)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              error: {
                message: "gemini-3.8-flash is currently experiencing high demand",
                code: "api_error",
              },
            }),
          ),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ output_text: "resposta do modelo fallback" }),
        text: () => Promise.resolve(""),
      });

    vi.stubGlobal("fetch", fetchMock);

    const result = await callGeminiInteraction("minha-chave", [{ type: "text", text: "oi" }]);
    expect(result).toEqual({
      text: "resposta do modelo fallback",
      modelUsed: "gemini-3.7-flash",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Primeiro tentou gemini-3.8-flash, depois gemini-3.7-flash
    const firstCallBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const secondCallBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(firstCallBody.model).toBe("gemini-3.8-flash");
    expect(secondCallBody.model).toBe("gemini-3.7-flash");
  });

  it("formata mensagem amigável quando todos os modelos falham com alta demanda", async () => {
    const highDemandError = JSON.stringify({
      error: { message: "spikes in demand are usually temporary" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve(highDemandError),
      }),
    );

    await expect(callGeminiInteraction("key", [{ type: "text", text: "oi" }])).rejects.toThrow(
      /alta demanda temporária nos servidores do Google/i,
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

describe("parseErrorMessage", () => {
  it("converte mensagem de high demand para texto amigável", () => {
    const raw = JSON.stringify({
      error: { message: "gemini-3.8-flash is currently experiencing high demand, spikes in demand" },
    });
    expect(parseErrorMessage(500, raw)).toContain("alta demanda temporária");
  });

  it("mantém a mensagem original se for outro erro da API", () => {
    const raw = JSON.stringify({
      error: { message: "API key expired" },
    });
    expect(parseErrorMessage(403, raw)).toBe("API key expired");
  });
});
