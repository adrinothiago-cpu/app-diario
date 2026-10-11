import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiaryEntryItem, EvolucaoClassificacao, EvolucaoCriterio, EvolucaoTopico } from "@/lib/events/types";
import {
  buildChatTurnPrompt,
  buildClassificationPrompt,
  classifyDiaryEntries,
  computeTendencia,
  computeVersaoTopicos,
  EvolucaoError,
  generateChatTurn,
  MAX_ENTRIES_PER_CLASSIFICATION_BATCH,
  MAX_RESUMO_CHARS,
  parseChatTurnResponse,
  parseClassificationResponse,
  selectEntriesForClassification,
} from "./gemini-evolucao";

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

function makeTopico(partial: Partial<EvolucaoTopico>): EvolucaoTopico {
  return {
    id: "t1",
    titulo: "Tópico",
    descricao: null,
    criadoEm: 1,
    arquivadoEm: null,
    rodadas: [],
    mensagens: [],
    ...partial,
  };
}

describe("computeVersaoTopicos", () => {
  it("é insensível à ordem dos tópicos", () => {
    const a = computeVersaoTopicos([{ id: "t1" }, { id: "t2" }]);
    const b = computeVersaoTopicos([{ id: "t2" }, { id: "t1" }]);
    expect(a).toBe(b);
  });

  it("muda quando o conjunto de tópicos muda", () => {
    const a = computeVersaoTopicos([{ id: "t1" }]);
    const b = computeVersaoTopicos([{ id: "t1" }, { id: "t2" }]);
    expect(a).not.toBe(b);
  });

  it("é vazio de forma determinística e estável (8 hex chars)", () => {
    expect(computeVersaoTopicos([])).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("selectEntriesForClassification", () => {
  it("inclui entrada nunca classificada", () => {
    const entries = [makeEntry({ id: "1", conteudo: "Nota", criadoEm: 100 })];
    const result = selectEntriesForClassification({ diaryEntries: entries, classificacoes: [], topicosAtivos: [] });
    expect(result.map((e) => e.id)).toEqual(["1"]);
  });

  it("exclui entrada vazia sem transcrição", () => {
    const entries = [makeEntry({ id: "1", conteudo: "   ", criadoEm: 100 })];
    const result = selectEntriesForClassification({ diaryEntries: entries, classificacoes: [], topicosAtivos: [] });
    expect(result).toEqual([]);
  });

  it("nunca reconsidera entrada já vinculada a um tópico real, mesmo após novos tópicos", () => {
    const entries = [makeEntry({ id: "1", conteudo: "Nota", criadoEm: 100 })];
    const topicosAtivos = [makeTopico({ id: "t1" }), makeTopico({ id: "t2" })];
    const versaoAntiga = computeVersaoTopicos([{ id: "t1" }]);
    const classificacoes: EvolucaoClassificacao[] = [
      { entryId: "1", topicoId: "t1", versaoTopicos: versaoAntiga, criadoEm: 50 },
    ];
    const result = selectEntriesForClassification({ diaryEntries: entries, classificacoes, topicosAtivos });
    expect(result).toEqual([]);
  });

  it("reconsidera entrada marcada null quando o conjunto de tópicos ativos muda", () => {
    const entries = [makeEntry({ id: "1", conteudo: "Nota", criadoEm: 100 })];
    const versaoAntiga = computeVersaoTopicos([{ id: "t1" }]);
    const classificacoes: EvolucaoClassificacao[] = [
      { entryId: "1", topicoId: null, versaoTopicos: versaoAntiga, criadoEm: 50 },
    ];
    const topicosAtivos = [makeTopico({ id: "t1" }), makeTopico({ id: "t2" })];
    const result = selectEntriesForClassification({ diaryEntries: entries, classificacoes, topicosAtivos });
    expect(result.map((e) => e.id)).toEqual(["1"]);
  });

  it("exclui entrada marcada null quando o conjunto de tópicos ativos não mudou", () => {
    const entries = [makeEntry({ id: "1", conteudo: "Nota", criadoEm: 100 })];
    const topicosAtivos = [makeTopico({ id: "t1" })];
    const versaoAtual = computeVersaoTopicos(topicosAtivos);
    const classificacoes: EvolucaoClassificacao[] = [
      { entryId: "1", topicoId: null, versaoTopicos: versaoAtual, criadoEm: 50 },
    ];
    const result = selectEntriesForClassification({ diaryEntries: entries, classificacoes, topicosAtivos });
    expect(result).toEqual([]);
  });

  it("ordena mais antigas primeiro e respeita o limite", () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ id: `e-${i}`, conteudo: `Nota ${i}`, criadoEm: 100 - i }),
    );
    const result = selectEntriesForClassification({
      diaryEntries: entries,
      classificacoes: [],
      topicosAtivos: [],
      limit: 2,
    });
    expect(result.map((e) => e.id)).toEqual(["e-4", "e-3"]);
  });

  it("usa MAX_ENTRIES_PER_CLASSIFICATION_BATCH como limite default", () => {
    const entries = Array.from({ length: MAX_ENTRIES_PER_CLASSIFICATION_BATCH + 10 }, (_, i) =>
      makeEntry({ id: `e-${i}`, conteudo: `Nota ${i}`, criadoEm: 1000 - i }),
    );
    const result = selectEntriesForClassification({ diaryEntries: entries, classificacoes: [], topicosAtivos: [] });
    expect(result).toHaveLength(MAX_ENTRIES_PER_CLASSIFICATION_BATCH);
  });
});

describe("buildClassificationPrompt", () => {
  it("inclui tópicos, entradas e instrução de usar null", () => {
    const entries = [makeEntry({ id: "1", conteudo: "Conversei com a Rosângela hoje" })];
    const topicos = [{ id: "t1", titulo: "Relação com a Rosângela", descricao: "colega de trabalho" }];
    const prompt = buildClassificationPrompt(entries, topicos);
    expect(prompt).toContain('id: "t1"');
    expect(prompt).toContain("Relação com a Rosângela");
    expect(prompt).toContain("colega de trabalho");
    expect(prompt).toContain("Conversei com a Rosângela hoje");
    expect(prompt).toContain("use null");
  });
});

describe("parseClassificationResponse", () => {
  it("aceita classificação válida cobrindo todas as entradas esperadas", () => {
    const raw = JSON.stringify({
      classificacoes: [
        { entryId: "1", topicoId: "t1" },
        { entryId: "2", topicoId: null },
      ],
    });
    expect(parseClassificationResponse(raw, ["1", "2"], ["t1"])).toEqual([
      { entryId: "1", topicoId: "t1" },
      { entryId: "2", topicoId: null },
    ]);
  });

  it("remove cercas de markdown", () => {
    const raw = "```json\n" + JSON.stringify({ classificacoes: [{ entryId: "1", topicoId: null }] }) + "\n```";
    expect(parseClassificationResponse(raw, ["1"], [])).toEqual([{ entryId: "1", topicoId: null }]);
  });

  it("rejeita JSON malformado", () => {
    expect(() => parseClassificationResponse("não é json", [], [])).toThrowError(EvolucaoError);
  });

  it("rejeita topicoId desconhecido (alucinação)", () => {
    const raw = JSON.stringify({ classificacoes: [{ entryId: "1", topicoId: "fantasma" }] });
    expect(() => parseClassificationResponse(raw, ["1"], ["t1"])).toThrowError(/desconhecido/);
  });

  it("rejeita cobertura incompleta (falta entrada)", () => {
    const raw = JSON.stringify({ classificacoes: [{ entryId: "1", topicoId: null }] });
    expect(() => parseClassificationResponse(raw, ["1", "2"], [])).toThrowError(/Cobertura incompleta/);
  });

  it("rejeita entrada inesperada (sobrando)", () => {
    const raw = JSON.stringify({
      classificacoes: [
        { entryId: "1", topicoId: null },
        { entryId: "2", topicoId: null },
      ],
    });
    expect(() => parseClassificationResponse(raw, ["1"], [])).toThrowError(/Cobertura incompleta/);
  });
});

describe("classifyDiaryEntries", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retorna lista vazia sem chamar a API quando não há entradas", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await classifyDiaryEntries("key", [], [])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("chama a API e retorna a classificação parseada", async () => {
    const mockResponse = {
      output_text: JSON.stringify({ classificacoes: [{ entryId: "1", topicoId: "t1" }] }),
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
      text: () => Promise.resolve(JSON.stringify(mockResponse)),
    });
    vi.stubGlobal("fetch", fetchMock);

    const entries = [makeEntry({ id: "1", conteudo: "Nota" })];
    const result = await classifyDiaryEntries("key", entries, [{ id: "t1", titulo: "X", descricao: null }]);
    expect(result).toEqual([{ entryId: "1", topicoId: "t1" }]);
  });
});

describe("computeTendencia", () => {
  it("sem_dados_suficientes quando não há rodada anterior", () => {
    expect(computeTendencia(null, [{ texto: "A", valor: true }])).toBe("sem_dados_suficientes");
  });

  it("melhorando quando mais critérios ficam true", () => {
    const anterior: EvolucaoCriterio[] = [{ texto: "A", valor: false }];
    const atual: EvolucaoCriterio[] = [{ texto: "A", valor: true }];
    expect(computeTendencia(anterior, atual)).toBe("melhorando");
  });

  it("piorando quando menos critérios ficam true", () => {
    const anterior: EvolucaoCriterio[] = [{ texto: "A", valor: true }];
    const atual: EvolucaoCriterio[] = [{ texto: "A", valor: false }];
    expect(computeTendencia(anterior, atual)).toBe("piorando");
  });

  it("estavel quando a contagem de true não muda", () => {
    const anterior: EvolucaoCriterio[] = [{ texto: "A", valor: true }, { texto: "B", valor: false }];
    const atual: EvolucaoCriterio[] = [{ texto: "A", valor: false }, { texto: "B", valor: true }];
    expect(computeTendencia(anterior, atual)).toBe("estavel");
  });
});

describe("buildChatTurnPrompt", () => {
  it("conversa nova (sem tópico) pede título, critérios e resposta", () => {
    const prompt = buildChatTurnPrompt({
      topico: null,
      criteriosAnteriores: null,
      resumoAnterior: null,
      diaryContext: [],
      historicoConversa: [],
      mensagemAtual: "não sei lidar com a Rosângela no trabalho",
    });
    expect(prompt).toContain("CONVERSA NOVA");
    expect(prompt).toContain("não sei lidar com a Rosângela no trabalho");
    expect(prompt).toContain("SEM TABUS OU MORALISMO");
    expect(prompt).toContain("RECOMENDAÇÃO BASEADA NO QUE FUNCIONA");
    expect(prompt).toContain('"titulo"');
  });

  it("tópico existente sem critérios ainda instrui defini-los", () => {
    const prompt = buildChatTurnPrompt({
      topico: { titulo: "Relação com a Rosângela" },
      criteriosAnteriores: null,
      resumoAnterior: null,
      diaryContext: [],
      historicoConversa: [],
      mensagemAtual: "oi",
    });
    expect(prompt).toContain("ainda não tem critérios definidos");
    expect(prompt).not.toContain('"titulo"');
  });

  it("tópico existente com critérios instrui reavaliar os mesmos, sem recriar", () => {
    const anteriores: EvolucaoCriterio[] = [{ texto: "Gera resultado profissional real?", valor: false }];
    const prompt = buildChatTurnPrompt({
      topico: { titulo: "X" },
      criteriosAnteriores: anteriores,
      resumoAnterior: "Resumo anterior.",
      diaryContext: [],
      historicoConversa: [{ autor: "usuario", texto: "oi" }, { autor: "ia", texto: "Olá!" }],
      mensagemAtual: "Melhorou um pouco",
    });
    expect(prompt).toContain("REAVALIE EXATAMENTE OS MESMOS");
    expect(prompt).toContain("Gera resultado profissional real?");
    expect(prompt).toContain("valor anterior: false");
    expect(prompt).toContain("Resumo anterior.");
    expect(prompt).toContain("Usuário: oi");
    expect(prompt).toContain("Melhorou um pouco");
  });

  it("inclui as entradas novas do diário quando fornecidas", () => {
    const entries = [makeEntry({ id: "1", conteudo: "Reunião difícil hoje" })];
    const prompt = buildChatTurnPrompt({
      topico: { titulo: "X" },
      criteriosAnteriores: [{ texto: "A", valor: true }],
      resumoAnterior: null,
      diaryContext: entries,
      historicoConversa: [],
      mensagemAtual: null,
    });
    expect(prompt).toContain("Reunião difícil hoje");
    expect(prompt).toContain("sem uma pergunta específica para responder");
  });
});

describe("parseChatTurnResponse", () => {
  it("conversa nova exige e valida titulo + 3 a 6 critérios", () => {
    const raw = JSON.stringify({
      titulo: "Relação com a Rosângela",
      resposta: "Entendi, vamos acompanhar isso.",
      criterios: [
        { texto: "A", valor: true },
        { texto: "B", valor: false },
        { texto: "C", valor: true },
      ],
      resumo: "Resumo curto.",
    });
    expect(parseChatTurnResponse(raw, null)).toEqual({
      titulo: "Relação com a Rosângela",
      resposta: "Entendi, vamos acompanhar isso.",
      criterios: [
        { texto: "A", valor: true },
        { texto: "B", valor: false },
        { texto: "C", valor: true },
      ],
      resumo: "Resumo curto.",
    });
  });

  it("rejeita conversa nova sem titulo", () => {
    const raw = JSON.stringify({
      resposta: "x",
      criterios: [{ texto: "A", valor: true }, { texto: "B", valor: true }, { texto: "C", valor: true }],
      resumo: "x",
    });
    expect(() => parseChatTurnResponse(raw, null)).toThrowError(/titulo/);
  });

  it("rejeita menos de 3 critérios numa conversa nova", () => {
    const raw = JSON.stringify({ titulo: "X", resposta: "x", criterios: [{ texto: "A", valor: true }], resumo: "x" });
    expect(() => parseChatTurnResponse(raw, null)).toThrowError(EvolucaoError);
  });

  it("rejeita mais de 6 critérios numa conversa nova", () => {
    const criterios = Array.from({ length: 7 }, (_, i) => ({ texto: `C${i}`, valor: true }));
    const raw = JSON.stringify({ titulo: "X", resposta: "x", criterios, resumo: "x" });
    expect(() => parseChatTurnResponse(raw, null)).toThrowError(EvolucaoError);
  });

  it("turno seguinte não exige titulo e reconstrói o texto por posição", () => {
    const anteriores: EvolucaoCriterio[] = [
      { texto: "Gera resultado real?", valor: false },
      { texto: "Há reciprocidade?", valor: false },
    ];
    const raw = JSON.stringify({
      resposta: "Melhorou desde a última vez.",
      criterios: [{ valor: true }, { valor: false }],
      resumo: "Melhorou.",
    });
    expect(parseChatTurnResponse(raw, anteriores)).toEqual({
      resposta: "Melhorou desde a última vez.",
      criterios: [
        { texto: "Gera resultado real?", valor: true },
        { texto: "Há reciprocidade?", valor: false },
      ],
      resumo: "Melhorou.",
    });
  });

  it("rejeita quantidade de critérios divergente da conversa anterior", () => {
    const anteriores: EvolucaoCriterio[] = [{ texto: "X", valor: true }];
    const raw = JSON.stringify({ resposta: "x", criterios: [{ valor: true }, { valor: false }], resumo: "x" });
    expect(() => parseChatTurnResponse(raw, anteriores)).toThrowError(/Esperado 1 crit/);
  });

  it("remove cercas de markdown", () => {
    const raw =
      "```json\n" +
      JSON.stringify({
        titulo: "X",
        resposta: "x",
        criterios: [{ texto: "A", valor: true }, { texto: "B", valor: true }, { texto: "C", valor: true }],
        resumo: "x",
      }) +
      "\n```";
    expect(parseChatTurnResponse(raw, null).titulo).toBe("X");
  });

  it("rejeita JSON malformado", () => {
    expect(() => parseChatTurnResponse("não é json", null)).toThrowError(EvolucaoError);
  });

  it("rejeita resposta sem o campo 'resposta'", () => {
    const raw = JSON.stringify({
      titulo: "X",
      criterios: [{ texto: "A", valor: true }, { texto: "B", valor: true }, { texto: "C", valor: true }],
      resumo: "x",
    });
    expect(() => parseChatTurnResponse(raw, null)).toThrowError(/resposta/);
  });

  it("trunca o resumo no teto de segurança (MAX_RESUMO_CHARS) em vez de deixar crescer sem limite", () => {
    const raw = JSON.stringify({
      titulo: "X",
      resposta: "x",
      criterios: [{ texto: "A", valor: true }, { texto: "B", valor: true }, { texto: "C", valor: true }],
      resumo: "a".repeat(MAX_RESUMO_CHARS + 500),
    });
    expect(parseChatTurnResponse(raw, null).resumo.length).toBe(MAX_RESUMO_CHARS);
  });
});

describe("generateChatTurn", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falha com EvolucaoError se a primeira mensagem de um tópico novo vier vazia", async () => {
    await expect(
      generateChatTurn("key", {
        topico: null,
        criteriosAnteriores: null,
        resumoAnterior: null,
        diaryContext: [],
        historicoConversa: [],
        mensagemAtual: null,
      }),
    ).rejects.toThrowError(/primeira mensagem/);
  });

  it("executa a chamada HTTP, calcula tendência em código e propaga o título na conversa nova", async () => {
    const mockResponse = {
      output_text: JSON.stringify({
        titulo: "Relação com a Rosângela",
        resposta: "Vamos acompanhar isso juntos.",
        criterios: [{ texto: "A", valor: true }, { texto: "B", valor: true }, { texto: "C", valor: false }],
        resumo: "Resumo.",
      }),
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
      text: () => Promise.resolve(JSON.stringify(mockResponse)),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateChatTurn("key", {
      topico: null,
      criteriosAnteriores: null,
      resumoAnterior: null,
      diaryContext: [],
      historicoConversa: [],
      mensagemAtual: "não sei lidar com a Rosângela",
    });
    expect(result.titulo).toBe("Relação com a Rosângela");
    expect(result.tendencia).toBe("sem_dados_suficientes");
    expect(result.modeloUsado).toBe("gemini-3.8-flash");
  });

  it("num turno seguinte calcula a tendência comparando com os critérios anteriores", async () => {
    const mockResponse = {
      output_text: JSON.stringify({
        resposta: "Melhorou.",
        criterios: [{ valor: true }],
        resumo: "Melhorou desde a última vez.",
      }),
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
      text: () => Promise.resolve(JSON.stringify(mockResponse)),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateChatTurn("key", {
      topico: { titulo: "X" },
      criteriosAnteriores: [{ texto: "A", valor: false }],
      resumoAnterior: "Resumo anterior.",
      diaryContext: [],
      historicoConversa: [],
      mensagemAtual: null,
    });
    expect(result.tendencia).toBe("melhorando");
    expect(result.criterios).toEqual([{ texto: "A", valor: true }]);
  });
});
