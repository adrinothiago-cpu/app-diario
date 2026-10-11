import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildInterpretacaoFalaPrompt,
  buildTreinoInteracaoPrompt,
  buildTreinoPlanoPrompt,
  buildTreinadorPrompt,
  generateTreinoInteracao,
  generateTreinoPlano,
  interpretarFalaDoExercicio,
  parseInterpretacaoFalaResponse,
  parseTreinadorResponse,
  parseTreinoInteracaoResponse,
  parseTreinoPlanoResponse,
  processarTurnoTreinador,
  TreinoError,
} from "./gemini-treino";

describe("buildTreinoPlanoPrompt", () => {
  it("lista os grupamentos na ordem recebida e cita o rodízio de foco", () => {
    const prompt = buildTreinoPlanoPrompt({ treino: "A", grupamentos: ["Peito", "Ombro", "Tríceps"], minutos: 40 });
    expect(prompt).toContain("Treino A");
    expect(prompt).toContain("1. Peito");
    expect(prompt).toContain("2. Ombro");
    expect(prompt).toContain("3. Tríceps");
    expect(prompt).toContain("40 minutos");
    expect(prompt).toContain("RODÍZIO DE FOCO");
    expect(prompt).toContain("2 exercícios");
  });
});

const exPlano = (grupamento: string, nome: string) => ({ grupamento, nome, series: 3, repeticoes: "8-12" });

describe("parseTreinoPlanoResponse", () => {
  const grupamentos = ["Peito", "Ombro"];
  const validos = [exPlano("Peito", "Supino reto"), exPlano("Peito", "Supino inclinado"), exPlano("Ombro", "Desenvolvimento"), exPlano("Ombro", "Elevação lateral")];

  it("parseia um banco com pelo menos 2 exercícios por grupamento", () => {
    const exercicios = parseTreinoPlanoResponse(JSON.stringify({ exercicios: validos }), grupamentos);
    expect(exercicios).toHaveLength(4);
    expect(exercicios[0]).toEqual({ grupamento: "Peito", nome: "Supino reto", series: 3, repeticoes: "8-12" });
  });

  it("remove cercas de código markdown antes de parsear", () => {
    const raw = "```json\n" + JSON.stringify({ exercicios: validos }) + "\n```";
    expect(() => parseTreinoPlanoResponse(raw, grupamentos)).not.toThrow();
  });

  it("rejeita JSON inválido", () => {
    expect(() => parseTreinoPlanoResponse("não é json", grupamentos)).toThrow(TreinoError);
  });

  it("rejeita grupamento com menos de 2 exercícios (qualquer um pode virar foco)", () => {
    const raw = JSON.stringify({ exercicios: [...validos.slice(0, 3)] });
    expect(() => parseTreinoPlanoResponse(raw, grupamentos)).toThrow(/Ombro/);
  });

  it("rejeita 'series' ausente ou não positivo", () => {
    const raw = JSON.stringify({ exercicios: [{ ...validos[0], series: 0 }, ...validos.slice(1)] });
    expect(() => parseTreinoPlanoResponse(raw, grupamentos)).toThrow(/series/);
  });
});

describe("buildTreinoInteracaoPrompt", () => {
  it("marca foco e o 5º opcional, e inclui o histórico", () => {
    const prompt = buildTreinoInteracaoPrompt({
      treino: "A",
      grupamentoFoco: "Peito",
      exerciciosDoDia: [
        { exercicio: exPlano("Peito", "Supino"), emFoco: true, extra: false },
        { exercicio: exPlano("Ombro", "Desenvolvimento"), emFoco: false, extra: false },
        { exercicio: exPlano("Peito", "Crucifixo"), emFoco: true, extra: true },
      ],
      seriesDaSessao: [],
      historicoRecente: [{ exercicio: "Supino", series: 3, repeticoes: 10, cargaKg: 40, rpe: 8 }],
      historicoConversa: [],
      mensagemAtual: "quanto de carga eu coloco hoje?",
    });
    expect(prompt).toContain("Supino (Peito, FOCO)");
    expect(prompt).toContain("Crucifixo (Peito, FOCO, 5º, só se der tempo)");
    expect(prompt).toContain("Supino: 3x10 a 40kg, RPE 8");
    expect(prompt).toContain("quanto de carga eu coloco hoje?");
  });

  it("formata esteira por duração em vez de carga", () => {
    const prompt = buildTreinoInteracaoPrompt({
      treino: "A",
      grupamentoFoco: "Peito",
      exerciciosDoDia: [],
      seriesDaSessao: [
        { exercicio: "Esteira", grupamento: "Cardio", series: 0, repeticoes: 0, cargaKg: 0, rpe: 6, observacoes: "", duracaoMin: 20 },
      ],
      historicoRecente: [],
      historicoConversa: [],
      mensagemAtual: "ok?",
    });
    expect(prompt).toContain("Esteira: 20 min, RPE 6");
  });

  it("pede parecer final quando mensagemAtual é null", () => {
    const prompt = buildTreinoInteracaoPrompt({
      treino: "A",
      grupamentoFoco: "Peito",
      exerciciosDoDia: [],
      seriesDaSessao: [],
      historicoRecente: [],
      historicoConversa: [],
      mensagemAtual: null,
    });
    expect(prompt).toContain("PARECER FINAL");
  });
});

describe("parseTreinoInteracaoResponse", () => {
  it("extrai a resposta do JSON", () => {
    expect(parseTreinoInteracaoResponse(JSON.stringify({ resposta: "Aumente 2.5kg" }))).toEqual({ resposta: "Aumente 2.5kg" });
  });

  it("rejeita resposta vazia", () => {
    expect(() => parseTreinoInteracaoResponse(JSON.stringify({ resposta: "   " }))).toThrow(TreinoError);
  });
});

describe("generateTreinoPlano", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("chama a API e devolve os exercícios parseados com o modelo usado", async () => {
    const mockResponse = {
      output_text: JSON.stringify({ exercicios: [exPlano("Peito", "Supino"), exPlano("Peito", "Crucifixo")] }),
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
      text: () => Promise.resolve(JSON.stringify(mockResponse)),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateTreinoPlano("key", { treino: "A", grupamentos: ["Peito"] });
    expect(result.exercicios[0].nome).toBe("Supino");
    expect(result.modeloUsado).toBeTruthy();
  });
});

describe("generateTreinoInteracao", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("chama a API e devolve a resposta com o modelo usado", async () => {
    const mockResponse = { output_text: JSON.stringify({ resposta: "Suba a carga na próxima série." }) };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
      text: () => Promise.resolve(JSON.stringify(mockResponse)),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateTreinoInteracao("key", {
      treino: "A",
      grupamentoFoco: "Peito",
      exerciciosDoDia: [],
      seriesDaSessao: [],
      historicoRecente: [],
      historicoConversa: [],
      mensagemAtual: "e aí, como tá indo?",
    });
    expect(result.resposta).toBe("Suba a carga na próxima série.");
    expect(result.modeloUsado).toBeTruthy();
  });
});

describe("buildInterpretacaoFalaPrompt", () => {
  it("cita o exercício e o alvo, e manda deixar null o que não foi dito", () => {
    const prompt = buildInterpretacaoFalaPrompt(exPlano("Peito", "Supino reto"));
    expect(prompt).toContain('"Supino reto"');
    expect(prompt).toContain("3 séries de 8-12");
    expect(prompt).toContain("null");
  });
});

describe("parseInterpretacaoFalaResponse", () => {
  it("extrai os campos ditos e mantém null nos não ditos", () => {
    const r = parseInterpretacaoFalaResponse(
      JSON.stringify({ series: 3, repeticoes: 8, cargaKg: 42.5, rpe: null, observacoes: "última série 10, 10 e 8" }),
    );
    expect(r).toEqual({ series: 3, repeticoes: 8, cargaKg: 42.5, rpe: null, observacoes: "última série 10, 10 e 8" });
  });

  it("trata observação vazia e campos ausentes como null", () => {
    expect(parseInterpretacaoFalaResponse(JSON.stringify({ cargaKg: 20, observacoes: "  " }))).toEqual({
      series: null,
      repeticoes: null,
      cargaKg: 20,
      rpe: null,
      observacoes: null,
    });
  });

  it("rejeita número inválido", () => {
    expect(() => parseInterpretacaoFalaResponse(JSON.stringify({ series: "três" }))).toThrow(/series/);
  });
});

describe("interpretarFalaDoExercicio", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("manda texto + áudio e devolve os campos com o modelo usado", async () => {
    const mockResponse = { output_text: JSON.stringify({ series: 3, repeticoes: 10, cargaKg: 40, rpe: 8, observacoes: null }) };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
      text: () => Promise.resolve(JSON.stringify(mockResponse)),
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await interpretarFalaDoExercicio("key", {
      exercicio: exPlano("Peito", "Supino reto"),
      audioBase64: "AAAA",
      mimeType: "audio/webm",
    });
    expect(r.cargaKg).toBe(40);
    expect(r.modeloUsado).toBeTruthy();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.input[1]).toEqual({ type: "audio", data: "AAAA", mime_type: "audio/webm" });
  });
});

describe("Treinador com Memória", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("buildTreinadorPrompt monta o prompt com memória, histórico e mensagem", () => {
    const prompt = buildTreinadorPrompt({
      memoria: {
        resumo: "Aluno em boa evolução no supino",
        ultimoTreinoFeito: "A",
        ultimoFocoFeito: "Peito",
        proximoTreinoSugerido: "B",
        proximoFocoSugerido: "Anterior",
        cargasChave: { "Supino Reto": { cargaKg: 50, repeticoes: 10, data: "2026-10-10" } },
        observacoesGerais: "Sem dores",
        atualizadoEm: 1000,
      },
      historicoExercicios: [{ exercicio: "Supino Reto", series: 3, repeticoes: 10, cargaKg: 50, rpe: 8, data: "2026-10-10" }],
      mensagensRecentes: [{ id: "m1", autor: "treinador", texto: "Bom treino!", criadoEm: 1000 }],
      mensagemTexto: "Hoje fiz agachamento com 60kg",
      temAudio: false,
    });

    expect(prompt).toContain("personal trainer pessoal do Thiago");
    expect(prompt).toContain("Aluno em boa evolução no supino");
    expect(prompt).toContain("Supino Reto — 3x10 com 50kg");
    expect(prompt).toContain("Hoje fiz agachamento com 60kg");
  });

  it("parseTreinadorResponse parseia resposta com séries para registrar e memória", () => {
    const mockJson = JSON.stringify({
      resposta: "Excelente treino de peito! Registrei seu supino.",
      seriesParaRegistrar: [
        {
          exercicio: "Supino Reto",
          grupamento: "Peito",
          series: 3,
          repeticoes: 10,
          cargaKg: 50,
          rpe: 8,
          observacoes: "Subiu carga",
        },
      ],
      memoriaAtualizada: {
        resumo: "Supino subiu para 50kg",
        ultimoTreinoFeito: "A",
        ultimoFocoFeito: "Peito",
        proximoTreinoSugerido: "B",
        proximoFocoSugerido: "Anterior",
        cargasChave: { "Supino Reto": { cargaKg: 50, repeticoes: 10, data: "2026-10-11" } },
      },
    });

    const parsed = parseTreinadorResponse(mockJson);
    expect(parsed.resposta).toBe("Excelente treino de peito! Registrei seu supino.");
    expect(parsed.seriesParaRegistrar).toHaveLength(1);
    expect(parsed.seriesParaRegistrar[0].exercicio).toBe("Supino Reto");
    expect(parsed.seriesParaRegistrar[0].cargaKg).toBe(50);
    expect(parsed.memoriaAtualizada.resumo).toBe("Supino subiu para 50kg");
    expect(parsed.memoriaAtualizada.proximoTreinoSugerido).toBe("B");
  });

  it("processarTurnoTreinador chama API da Gemini e formata resultado", async () => {
    const mockJson = {
      output_text: JSON.stringify({
        resposta: "Registrado com sucesso!",
        seriesParaRegistrar: [],
        memoriaAtualizada: {
          resumo: "Descanso hoje",
          proximoTreinoSugerido: "A",
        },
      }),
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockJson),
      text: () => Promise.resolve(JSON.stringify(mockJson)),
    });
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await processarTurnoTreinador("fake-key", {
      memoria: null,
      historicoExercicios: [],
      mensagensRecentes: [],
      mensagemTexto: "Qual meu próximo treino?",
    });

    expect(resultado.resposta).toBe("Registrado com sucesso!");
    expect(resultado.modeloUsado).toBeTruthy();
  });
});
