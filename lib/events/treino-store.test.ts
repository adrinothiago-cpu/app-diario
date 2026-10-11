import { describe, expect, it } from "vitest";
import {
  computeProximoFoco,
  reduceTodosExerciciosRealizados,
  reduceTreinoMemoria,
  reduceTreinoMensagens,
  reduceTreinoPlanos,
  reduceTreinoSessoes,
  selecionarExerciciosDaSessao,
  selectHistoricoRecente,
} from "./treino-store";
import type { DecryptedEvent, TreinoExercicioPlano, TreinoPlano } from "./types";

const planoEvent = (
  id: string,
  treino: "A" | "B" | "C",
  grupamentos: string[],
  exercicios: TreinoExercicioPlano[],
  createdAt: number,
  modeloUsado?: string,
): DecryptedEvent => ({ type: "treino_plano_atualizado", treino, grupamentos, exercicios, modeloUsado, id, createdAt });

const iniciada = (id: string, sessaoId: string, treino: "A" | "B" | "C", grupamentoFoco: string, createdAt: number): DecryptedEvent => ({
  type: "treino_sessao_iniciada",
  sessaoId,
  treino,
  grupamentoFoco,
  id,
  createdAt,
});

const finalizada = (
  id: string,
  sessaoId: string,
  createdAt: number,
  extra?: { feedbackIa?: string; modeloUsado?: string },
): DecryptedEvent => ({ type: "treino_sessao_finalizada", sessaoId, id, createdAt, ...extra });

const serie = (
  id: string,
  sessaoId: string,
  exercicio: string,
  createdAt: number,
  extra?: Partial<{ Series: number; Repeticoes: number; Carga_kg: number; RPE: number; Grupamento: string }>,
): DecryptedEvent => ({
  type: "workout_set",
  Data: "2026-09-30",
  Hora_Inicio: "10:00",
  Hora_Fim: "10:05",
  Etapa: "A",
  Exercicio: exercicio,
  Series: 3,
  Repeticoes: 10,
  Carga_kg: 40,
  RPE: 8,
  Observacoes: "",
  SessaoId: sessaoId,
  id,
  createdAt,
  ...extra,
});

const ex = (grupamento: string, nome: string, series = 3, repeticoes = "8-12"): TreinoExercicioPlano => ({
  grupamento,
  nome,
  series,
  repeticoes,
});

describe("reduceTreinoPlanos", () => {
  it("mantém apenas o plano mais recente por treino (singleton por sobrescrita)", () => {
    const events = [
      planoEvent("e1", "A", ["Peito"], [ex("Peito", "Supino")], 1),
      planoEvent("e2", "A", ["Peito"], [ex("Peito", "Supino inclinado")], 2, "gemini-2.5-flash"),
    ];
    const planos = reduceTreinoPlanos(events);
    expect(planos.A?.exercicios[0].nome).toBe("Supino inclinado");
    expect(planos.A?.modeloUsado).toBe("gemini-2.5-flash");
    expect(planos.B).toBeNull();
  });

  it("trata cada letra de forma independente", () => {
    const events = [planoEvent("e1", "A", ["Peito"], [], 1), planoEvent("e2", "B", ["Anterior"], [], 2)];
    const planos = reduceTreinoPlanos(events);
    expect(planos.A?.grupamentos).toEqual(["Peito"]);
    expect(planos.B?.grupamentos).toEqual(["Anterior"]);
    expect(planos.C).toBeNull();
  });
});

describe("reduceTreinoSessoes", () => {
  it("acumula séries de uma sessão via SessaoId e ignora séries de outra sessão", () => {
    const events = [
      iniciada("e1", "s1", "A", "Peito", 1),
      serie("e2", "s1", "Supino", 2),
      serie("e3", "s2-fantasma", "Desenvolvimento", 3),
    ];
    const sessoes = reduceTreinoSessoes(events);
    expect(sessoes).toHaveLength(1);
    expect(sessoes[0].series).toHaveLength(1);
    expect(sessoes[0].series[0].exercicio).toBe("Supino");
  });

  it("finaliza a sessão com feedback opcional da IA", () => {
    const events = [iniciada("e1", "s1", "A", "Peito", 1), finalizada("e2", "s1", 2, { feedbackIa: "Bom progresso", modeloUsado: "gemini-2.5-flash" })];
    const sessao = reduceTreinoSessoes(events)[0];
    expect(sessao.finalizadoEm).toBe(2);
    expect(sessao.feedbackIa).toBe("Bom progresso");
    expect(sessao.modeloUsado).toBe("gemini-2.5-flash");
  });

  it("finaliza sem feedback quando o usuário não pediu parecer", () => {
    const events = [iniciada("e1", "s1", "A", "Peito", 1), finalizada("e2", "s1", 2)];
    const sessao = reduceTreinoSessoes(events)[0];
    expect(sessao.finalizadoEm).toBe(2);
    expect(sessao.feedbackIa).toBeNull();
  });

  it("ordena sessões por início, ignora workout_set sem SessaoId (eventos antigos de auditoria)", () => {
    const events = [
      iniciada("e1", "s2", "B", "Anterior", 5),
      iniciada("e2", "s1", "A", "Peito", 1),
      { type: "workout_set", Data: "x", Hora_Inicio: "x", Hora_Fim: "x", Etapa: "A", Exercicio: "Livre", Series: 1, Repeticoes: 1, Carga_kg: 1, RPE: 1, Observacoes: "", id: "e3", createdAt: 3 } as DecryptedEvent,
    ];
    const sessoes = reduceTreinoSessoes(events);
    expect(sessoes.map((s) => s.id)).toEqual(["s1", "s2"]);
  });
});

describe("computeProximoFoco", () => {
  const plano: TreinoPlano = {
    treino: "A",
    grupamentos: ["Peito", "Ombro", "Tríceps"],
    exercicios: [],
    modeloUsado: null,
    atualizadoEm: 1,
  };

  it("começa no primeiro grupamento sem sessões concluídas", () => {
    expect(computeProximoFoco(plano, 0)).toBe("Peito");
  });

  it("avança ciclicamente a cada sessão concluída", () => {
    expect(computeProximoFoco(plano, 1)).toBe("Ombro");
    expect(computeProximoFoco(plano, 2)).toBe("Tríceps");
    expect(computeProximoFoco(plano, 3)).toBe("Peito");
  });
});

describe("reduceTreinoPlanos — planos da 1ª versão", () => {
  it("assume 3 séries quando o evento antigo não tem `series`", () => {
    const antigo = { grupamento: "Peito", nome: "Supino", seriesBase: 2, seriesFoco: 4, repeticoes: "8-12" } as unknown as TreinoExercicioPlano;
    const planos = reduceTreinoPlanos([planoEvent("e1", "A", ["Peito"], [antigo], 1)]);
    expect(planos.A?.exercicios[0].series).toBe(3);
  });
});

describe("selecionarExerciciosDaSessao", () => {
  const planoA: TreinoPlano = {
    treino: "A",
    grupamentos: ["Peito", "Ombro", "Tríceps"],
    exercicios: [
      ex("Peito", "Supino reto"),
      ex("Peito", "Supino inclinado"),
      ex("Peito", "Crucifixo"),
      ex("Ombro", "Desenvolvimento"),
      ex("Ombro", "Elevação lateral"),
      ex("Tríceps", "Tríceps corda"),
      ex("Tríceps", "Tríceps francês"),
    ],
    modeloUsado: null,
    atualizadoEm: 1,
  };

  it("2 do foco + 1 de cada um dos demais + 5º extra do foco", () => {
    const sessao = selecionarExerciciosDaSessao(planoA, "Peito");
    expect(sessao.map((s) => s.exercicio.nome)).toEqual([
      "Supino reto",
      "Supino inclinado",
      "Desenvolvimento",
      "Tríceps corda",
      "Crucifixo",
    ]);
    expect(sessao.map((s) => s.emFoco)).toEqual([true, true, false, false, true]);
    expect(sessao.map((s) => s.extra)).toEqual([false, false, false, false, true]);
  });

  it("sem 3º exercício do foco, o 5º vem do próximo dos demais", () => {
    const sessao = selecionarExerciciosDaSessao(planoA, "Ombro");
    expect(sessao.map((s) => s.exercicio.nome)).toEqual([
      "Desenvolvimento",
      "Elevação lateral",
      "Supino reto",
      "Tríceps corda",
      "Supino inclinado",
    ]);
    expect(sessao[4].extra).toBe(true);
    expect(sessao[4].emFoco).toBe(false);
  });

  it("com só um grupamento além do foco (Treino B), os 2 dos demais vêm dele", () => {
    const planoB: TreinoPlano = {
      treino: "B",
      grupamentos: ["Anterior", "Posterior"],
      exercicios: [ex("Anterior", "Agachamento"), ex("Anterior", "Leg press"), ex("Posterior", "Stiff"), ex("Posterior", "Mesa flexora")],
      modeloUsado: null,
      atualizadoEm: 1,
    };
    const sessao = selecionarExerciciosDaSessao(planoB, "Posterior");
    expect(sessao.map((s) => s.exercicio.nome)).toEqual(["Stiff", "Mesa flexora", "Agachamento", "Leg press"]);
  });
});

describe("selectHistoricoRecente", () => {
  it("filtra por nome de exercício, mais recente primeiro, respeitando o limite por exercício", () => {
    const sessoes = reduceTreinoSessoes([
      iniciada("e1", "s1", "A", "Peito", 1),
      serie("e2", "s1", "Supino", 2, { Carga_kg: 40 }),
      serie("e3", "s1", "Supino", 3, { Carga_kg: 42.5 }),
      serie("e4", "s1", "Supino", 4, { Carga_kg: 45 }),
      serie("e5", "s1", "Desenvolvimento", 5, { Carga_kg: 20 }),
    ]);
    const historico = selectHistoricoRecente(sessoes, ["Supino"], 2);
    expect(historico).toHaveLength(2);
    expect(historico[0].cargaKg).toBe(45);
    expect(historico[1].cargaKg).toBe(42.5);
  });
});

describe("reduceTreinoMemoria", () => {
  it("extrai a memória mais recente do treinador", () => {
    const events: DecryptedEvent[] = [
      {
        type: "treino_memoria_atualizada",
        resumo: "Memória antiga",
        id: "m1",
        createdAt: 100,
      },
      {
        type: "treino_memoria_atualizada",
        resumo: "Memória recente",
        ultimoTreinoFeito: "A",
        ultimoFocoFeito: "Peito",
        proximoTreinoSugerido: "B",
        proximoFocoSugerido: "Anterior",
        cargasChave: { "Supino Reto": { cargaKg: 50, repeticoes: 10, data: "2026-10-11" } },
        id: "m2",
        createdAt: 200,
      },
    ];

    const mem = reduceTreinoMemoria(events);
    expect(mem).not.toBeNull();
    expect(mem?.resumo).toBe("Memória recente");
    expect(mem?.ultimoTreinoFeito).toBe("A");
    expect(mem?.proximoTreinoSugerido).toBe("B");
    expect(mem?.cargasChave["Supino Reto"].cargaKg).toBe(50);
  });
});

describe("reduceTreinoMensagens", () => {
  it("retorna as mensagens ordenadas cronologicamente", () => {
    const events: DecryptedEvent[] = [
      {
        type: "treino_mensagem_registrada",
        mensagemId: "msg2",
        autor: "treinador",
        texto: "Bom trabalho!",
        id: "e2",
        createdAt: 200,
      },
      {
        type: "treino_mensagem_registrada",
        mensagemId: "msg1",
        autor: "usuario",
        texto: "Fiz supino 50kg",
        id: "e1",
        createdAt: 100,
      },
    ];

    const msgs = reduceTreinoMensagens(events);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].texto).toBe("Fiz supino 50kg");
    expect(msgs[1].texto).toBe("Bom trabalho!");
  });
});

describe("reduceTodosExerciciosRealizados", () => {
  it("coleta todos os workout_set ordenados por data decrescente", () => {
    const events: DecryptedEvent[] = [
      serie("e1", "s1", "Supino", 100, { Carga_kg: 40 }),
      serie("e2", "s1", "Desenvolvimento", 200, { Carga_kg: 20 }),
    ];

    const todos = reduceTodosExerciciosRealizados(events);
    expect(todos).toHaveLength(2);
    expect(todos[0].exercicio).toBe("Desenvolvimento");
    expect(todos[1].exercicio).toBe("Supino");
  });
});
