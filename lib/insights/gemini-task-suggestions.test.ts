import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiaryEntryItem } from "@/lib/events/types";
import {
  buildTaskSuggestionsPrompt,
  generateTaskSuggestions,
  parseTaskSuggestionsResponse,
  selectEntriesForTaskSuggestions,
  TaskSuggestionError,
} from "./gemini-task-suggestions";

function makeEntry(partial: Partial<DiaryEntryItem>): DiaryEntryItem {
  return {
    id: "e1",
    conteudo: "",
    humor: 3,
    horario: "10:00",
    latitude: null,
    longitude: null,
    precisao: null,
    audioBase64: null,
    audioMimeType: null,
    audioDuracaoSeg: null,
    transcricao: null,
    criadoEm: 1000,
    ...partial,
  };
}

describe("selectEntriesForTaskSuggestions", () => {
  it("filtra entradas vazias e mantém as com texto ou transcrição", () => {
    const entries: DiaryEntryItem[] = [
      makeEntry({ id: "1", conteudo: "Preciso marcar o dentista", criadoEm: 300 }),
      makeEntry({ id: "2", conteudo: "   ", criadoEm: 200 }),
      makeEntry({ id: "3", conteudo: "", transcricao: "Lembrar de pagar o boleto", criadoEm: 100 }),
    ];
    expect(selectEntriesForTaskSuggestions(entries).map((e) => e.id)).toEqual(["1", "3"]);
  });

  it("respeita o limite máximo", () => {
    const entries: DiaryEntryItem[] = Array.from({ length: 20 }, (_, i) =>
      makeEntry({ id: `e-${i}`, conteudo: `Nota ${i}`, criadoEm: 1000 - i }),
    );
    expect(selectEntriesForTaskSuggestions(entries, 15)).toHaveLength(15);
  });
});

describe("buildTaskSuggestionsPrompt", () => {
  it("inclui as entradas, a data de hoje e as tarefas já ativas", () => {
    const entries = [makeEntry({ id: "1", conteudo: "Preciso ligar pro dentista amanhã" })];
    const prompt = buildTaskSuggestionsPrompt(entries, ["Comprar leite"], "2026-09-24");
    expect(prompt).toContain("Preciso ligar pro dentista amanhã");
    expect(prompt).toContain("2026-09-24");
    expect(prompt).toContain("Comprar leite");
    expect(prompt).toContain("NÃO sugira nada equivalente");
  });

  it("indica que não há tarefas ativas quando a lista está vazia", () => {
    const entries = [makeEntry({ id: "1", conteudo: "Dia tranquilo" })];
    const prompt = buildTaskSuggestionsPrompt(entries, [], "2026-09-24");
    expect(prompt).toContain("Não há tarefas ativas cadastradas ainda.");
  });
});

describe("parseTaskSuggestionsResponse", () => {
  it("faz parse de uma lista válida de sugestões", () => {
    const raw = JSON.stringify({
      sugestoes: [
        { texto: "Ligar pro dentista", prioridade: 2, vencimento: "2026-09-25", motivo: "Mencionado no diário" },
      ],
    });
    expect(parseTaskSuggestionsResponse(raw)).toEqual([
      { texto: "Ligar pro dentista", prioridade: 2, vencimento: "2026-09-25", motivo: "Mencionado no diário" },
    ]);
  });

  it("aceita lista vazia (sem pendências claras)", () => {
    expect(parseTaskSuggestionsResponse(JSON.stringify({ sugestoes: [] }))).toEqual([]);
  });

  it("remove cercas de markdown", () => {
    const wrapped = "```json\n" + JSON.stringify({ sugestoes: [] }) + "\n```";
    expect(parseTaskSuggestionsResponse(wrapped)).toEqual([]);
  });

  it("rejeita JSON malformado", () => {
    expect(() => parseTaskSuggestionsResponse("não é json")).toThrowError(TaskSuggestionError);
  });

  it("rejeita quando falta o campo 'sugestoes'", () => {
    expect(() => parseTaskSuggestionsResponse(JSON.stringify({ foo: [] }))).toThrowError(/sugestoes/);
  });

  it("rejeita sugestão sem texto", () => {
    const raw = JSON.stringify({ sugestoes: [{ prioridade: 1, vencimento: null, motivo: "x" }] });
    expect(() => parseTaskSuggestionsResponse(raw)).toThrowError(/texto/);
  });

  it("rejeita prioridade inválida", () => {
    const raw = JSON.stringify({
      sugestoes: [{ texto: "x", prioridade: 9, vencimento: null, motivo: "x" }],
    });
    expect(() => parseTaskSuggestionsResponse(raw)).toThrowError(/prioridade/);
  });

  it("rejeita vencimento que não é string nem null", () => {
    const raw = JSON.stringify({
      sugestoes: [{ texto: "x", prioridade: 1, vencimento: 123, motivo: "x" }],
    });
    expect(() => parseTaskSuggestionsResponse(raw)).toThrowError(/vencimento/);
  });
});

describe("generateTaskSuggestions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falha com TaskSuggestionError se não houver entradas elegíveis", async () => {
    await expect(generateTaskSuggestions("key", [], [], "2026-09-24")).rejects.toThrowError(
      /Nenhuma entrada de diário/,
    );
  });

  it("executa a chamada HTTP e retorna as sugestões parseadas", async () => {
    const mockResponse = {
      output_text: JSON.stringify({
        sugestoes: [{ texto: "Pagar o boleto", prioridade: 3, vencimento: "2026-09-25", motivo: "Mencionado com urgência" }],
      }),
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
      text: () => Promise.resolve(JSON.stringify(mockResponse)),
    });
    vi.stubGlobal("fetch", fetchMock);

    const entries = [makeEntry({ id: "1", conteudo: "Preciso pagar o boleto até amanhã" })];
    const result = await generateTaskSuggestions("chave-teste", entries, [], "2026-09-24");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      { texto: "Pagar o boleto", prioridade: 3, vencimento: "2026-09-25", motivo: "Mencionado com urgência" },
    ]);
  });
});
