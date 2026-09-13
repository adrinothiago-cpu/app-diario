import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiaryEntryItem, MoodInsights } from "@/lib/events/types";
import {
  buildInsightsPrompt,
  generateMoodInsights,
  InsightsError,
  parseInsightsResponse,
  selectEntriesForInsights,
} from "./gemini-insights";

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

describe("selectEntriesForInsights", () => {
  it("filtra entradas vazias sem transcrição e mantém entradas com texto ou áudio transcrito", () => {
    const entries: DiaryEntryItem[] = [
      makeEntry({ id: "1", conteudo: "Hoje foi produtivo", criadoEm: 300 }),
      makeEntry({ id: "2", conteudo: "   ", audioBase64: "blob", transcricao: null, criadoEm: 200 }),
      makeEntry({ id: "3", conteudo: "", transcricao: "Gravei este áudio no carro", criadoEm: 100 }),
    ];

    const result = selectEntriesForInsights(entries);
    expect(result.map((e) => e.id)).toEqual(["1", "3"]);
  });

  it("respeita o limite máximo de entradas", () => {
    const entries: DiaryEntryItem[] = Array.from({ length: 40 }, (_, i) =>
      makeEntry({ id: `e-${i}`, conteudo: `Nota ${i}`, criadoEm: 1000 - i }),
    );

    const result = selectEntriesForInsights(entries, 30);
    expect(result).toHaveLength(30);
    expect(result[0].id).toBe("e-0");
    expect(result[29].id).toBe("e-29");
  });
});

describe("buildInsightsPrompt", () => {
  it("inclui contexto da análise anterior e instrui refinamento quando previousInsights existe", () => {
    const entries: DiaryEntryItem[] = [
      makeEntry({ id: "1", conteudo: "Fiz caminhada e me senti bem", humor: 4 }),
    ];
    const prev: MoodInsights = {
      resumoGeral: "Humor instável.",
      gatilhosPositivos: ["Sol"],
      gatilhosNegativos: ["Noite mal dormida"],
      sugestoesMelhoria: ["Manter rotina"],
      tendencia: "sem_dados_suficientes",
      baseadoEmEntradas: 5,
    };

    const prompt = buildInsightsPrompt(entries, prev);
    expect(prompt).toContain("Aqui está o resumo da análise anterior:");
    expect(prompt).toContain("Humor instável.");
    expect(prompt).toContain("Fiz caminhada e me senti bem");
    expect(prompt).toContain('Atualize o resumo considerando as novas entradas');
  });

  it("orienta tendencia sem_dados_suficientes quando não há previousInsights", () => {
    const entries: DiaryEntryItem[] = [
      makeEntry({ id: "1", conteudo: "Primeiro dia de diário", humor: 5 }),
    ];

    const prompt = buildInsightsPrompt(entries, null);
    expect(prompt).toContain("Esta é a primeira análise das entradas de diário.");
    expect(prompt).toContain('"sem_dados_suficientes"');
    expect(prompt).toContain("Primeiro dia de diário");
  });

  it("inclui diretrizes de ausência de tabus, critério binário e foco em recompensa", () => {
    const entries = [makeEntry({ id: "1", conteudo: "Treinei pesado e me senti ótimo" })];
    const prompt = buildInsightsPrompt(entries, null);
    expect(prompt).toContain("SEM TABUS OU MORALISMO");
    expect(prompt).toContain("CRITÉRIO BINÁRIO BASEADO EM EFEITO REAL");
    expect(prompt).toContain("RECOMPENSA E REFORÇO POSITIVO");
  });
});

describe("parseInsightsResponse", () => {
  const validJson = JSON.stringify({
    resumoGeral: "Semana produtiva com estabilidade.",
    gatilhosPositivos: ["Treino pela manhã", "Leitura"],
    gatilhosNegativos: ["Prazo apertado"],
    sugestoesMelhoria: ["Pausas regulares"],
    tendencia: "melhorando",
  });

  it("faz parse de JSON válido e preenche baseadoEmEntradas e modeloUsado", () => {
    const res = parseInsightsResponse(validJson, 15, "gemini-3.8-flash");
    expect(res).toEqual({
      resumoGeral: "Semana produtiva com estabilidade.",
      gatilhosPositivos: ["Treino pela manhã", "Leitura"],
      gatilhosNegativos: ["Prazo apertado"],
      sugestoesMelhoria: ["Pausas regulares"],
      tendencia: "melhorando",
      baseadoEmEntradas: 15,
      modeloUsado: "gemini-3.8-flash",
    });
  });

  it("remove cercas de markdown ```json ... ```", () => {
    const wrapped = `\`\`\`json\n${validJson}\n\`\`\``;
    const res = parseInsightsResponse(wrapped, 8);
    expect(res.tendencia).toBe("melhorando");
    expect(res.baseadoEmEntradas).toBe(8);
  });

  it("rejeita JSON malformado", () => {
    expect(() => parseInsightsResponse("isto não é json")).toThrowError(InsightsError);
  });

  it("rejeita resposta sem resumoGeral", () => {
    const invalid = JSON.stringify({
      gatilhosPositivos: [],
      gatilhosNegativos: [],
      sugestoesMelhoria: [],
      tendencia: "estavel",
    });
    expect(() => parseInsightsResponse(invalid)).toThrowError(/resumoGeral/);
  });

  it("rejeita tendência inválida", () => {
    const invalid = JSON.stringify({
      resumoGeral: "Ok",
      gatilhosPositivos: [],
      gatilhosNegativos: [],
      sugestoesMelhoria: [],
      tendencia: "muito_bom",
    });
    expect(() => parseInsightsResponse(invalid)).toThrowError(/tendencia/);
  });

  it("rejeita listas com tipos não-string", () => {
    const invalid = JSON.stringify({
      resumoGeral: "Ok",
      gatilhosPositivos: [123],
      gatilhosNegativos: [],
      sugestoesMelhoria: [],
      tendencia: "estavel",
    });
    expect(() => parseInsightsResponse(invalid)).toThrowError(/gatilhosPositivos/);
  });
});

describe("generateMoodInsights", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falha com InsightsError se não houver entradas com texto/transcrição", async () => {
    await expect(generateMoodInsights("key", [], null)).rejects.toThrowError(
      /Nenhuma entrada de diário/,
    );
  });

  it("executa chamada HTTP à Gemini API e retorna objeto parseado com modeloUsado", async () => {
    const mockResponse = {
      output_text: JSON.stringify({
        resumoGeral: "Clima bom e foco.",
        gatilhosPositivos: ["Treino"],
        gatilhosNegativos: [],
        sugestoesMelhoria: ["Beber água"],
        tendencia: "sem_dados_suficientes",
      }),
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
      text: () => Promise.resolve(JSON.stringify(mockResponse)),
    });
    vi.stubGlobal("fetch", fetchMock);

    const entries = [makeEntry({ id: "1", conteudo: "Dia ótimo" })];
    const result = await generateMoodInsights("chave-teste", entries, null);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      resumoGeral: "Clima bom e foco.",
      gatilhosPositivos: ["Treino"],
      gatilhosNegativos: [],
      sugestoesMelhoria: ["Beber água"],
      tendencia: "sem_dados_suficientes",
      baseadoEmEntradas: 1,
      modeloUsado: "gemini-3.8-flash",
    });
  });
});
