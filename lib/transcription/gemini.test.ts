import { afterEach, describe, expect, it, vi } from "vitest";
import { transcribeAudio, TranscriptionError } from "./gemini";

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

describe("transcribeAudio", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("extrai o texto via output_text quando presente", async () => {
    mockFetchOnce({ output_text: "  Hoje foi um bom dia.  " });
    expect(await transcribeAudio("key", "base64==", "audio/webm")).toBe("Hoje foi um bom dia.");
  });

  it("extrai o texto navegando por steps[].content[] quando output_text não existe", async () => {
    mockFetchOnce({
      steps: [
        { type: "model_output", content: [{ type: "text", text: "Foi um dia" }] },
        { type: "model_output", content: [{ type: "text", text: "produtivo." }] },
      ],
    });
    expect(await transcribeAudio("key", "base64==", "audio/webm")).toBe("Foi um dia produtivo.");
  });

  it("ignora blocos de content sem campo text", async () => {
    mockFetchOnce({
      steps: [{ content: [{ type: "tool_call" }, { type: "text", text: "só isso importa" }] }],
    });
    expect(await transcribeAudio("key", "base64==", "audio/webm")).toBe("só isso importa");
  });

  it("lança TranscriptionError quando a resposta HTTP não é ok", async () => {
    mockFetchOnce({ error: "invalid key" }, false, 401);
    await expect(transcribeAudio("key", "base64==", "audio/webm")).rejects.toThrow(
      TranscriptionError,
    );
  });

  it("lança TranscriptionError quando não consegue extrair texto de nenhum formato conhecido", async () => {
    mockFetchOnce({ status: "completed", steps: [] });
    await expect(transcribeAudio("key", "base64==", "audio/webm")).rejects.toThrow(
      TranscriptionError,
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

    await transcribeAudio("minha-chave", "QUJD", "audio/webm");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-goog-api-key": "minha-chave" }),
      }),
    );
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.input).toEqual([
      expect.objectContaining({ type: "text" }),
      { type: "audio", data: "QUJD", mime_type: "audio/webm" },
    ]);
  });
});
