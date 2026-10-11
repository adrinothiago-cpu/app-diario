/**
 * Reduz o log de eventos brutos no estado da seção Treino: planos ABC
 * (padrão "singleton por sobrescrita" igual a `mood-insights-store.ts`) e
 * sessões (agregando os `workout_set` daquela sessão via `SessaoId`, igual
 * às rodadas de `evolucao-store.ts`).
 */
import type {
  DecryptedEvent,
  TreinoExercicioPlano,
  TreinoLetra,
  TreinoPlano,
  TreinoSerieIdentificada,
  TreinoSerieRegistrada,
  TreinoSessao,
} from "./types";

export const TREINO_LETRAS: TreinoLetra[] = ["A", "B", "C"];

/** Grupamentos padrão usados só pra dar contexto à IA na primeira geração do plano — depois de gerado, quem manda é `grupamentos` do próprio plano. */
export const GRUPAMENTOS_PADRAO: Record<TreinoLetra, string[]> = {
  A: ["Peito", "Ombro", "Tríceps"],
  B: ["Anterior", "Posterior"],
  C: ["Bíceps", "Antebraço", "Costas"],
};

export function reduceTreinoPlanos(events: DecryptedEvent[]): Record<TreinoLetra, TreinoPlano | null> {
  const planos: Record<TreinoLetra, TreinoPlano | null> = { A: null, B: null, C: null };
  for (const event of events) {
    if (event.type === "treino_plano_atualizado") {
      planos[event.treino] = {
        treino: event.treino,
        grupamentos: event.grupamentos,
        // Planos gravados na 1ª versão (seriesBase/seriesFoco, sem `series`) continuam no log imutável.
        exercicios: event.exercicios.map((e) => ({ ...e, series: typeof e.series === "number" ? e.series : 3 })),
        modeloUsado: event.modeloUsado ?? null,
        atualizadoEm: event.createdAt,
      };
    }
  }
  return planos;
}

export function reduceTreinoSessoes(events: DecryptedEvent[]): TreinoSessao[] {
  const sessoes = new Map<string, TreinoSessao>();

  for (const event of events) {
    if (event.type === "treino_sessao_iniciada") {
      sessoes.set(event.sessaoId, {
        id: event.sessaoId,
        treino: event.treino,
        grupamentoFoco: event.grupamentoFoco,
        iniciadoEm: event.createdAt,
        finalizadoEm: null,
        feedbackIa: null,
        modeloUsado: null,
        series: [],
      });
    } else if (event.type === "treino_sessao_finalizada") {
      const existing = sessoes.get(event.sessaoId);
      if (existing) {
        existing.finalizadoEm = event.createdAt;
        existing.feedbackIa = event.feedbackIa ?? null;
        existing.modeloUsado = event.modeloUsado ?? null;
      }
    } else if (event.type === "workout_set" && event.SessaoId) {
      const existing = sessoes.get(event.SessaoId);
      if (existing) {
        existing.series.push({
          exercicio: event.Exercicio,
          grupamento: event.Grupamento ?? null,
          series: event.Series,
          repeticoes: event.Repeticoes,
          cargaKg: event.Carga_kg,
          rpe: event.RPE,
          observacoes: event.Observacoes,
          duracaoMin: event.Duracao_min ?? null,
          criadoEm: event.createdAt,
        });
      }
    }
  }

  return [...sessoes.values()].sort((a, b) => a.iniciadoEm - b.iniciadoEm);
}

/**
 * Rodízio de foco: a cada sessão CONCLUÍDA do mesmo treino, o foco avança um
 * grupamento no array do plano (ordem fixa, cíclica). A primeira sessão de
 * um treino sempre começa no grupamento[0].
 */
export function computeProximoFoco(plano: TreinoPlano, sessoesConcluidasDesteTreino: number): string {
  const idx = sessoesConcluidasDesteTreino % plano.grupamentos.length;
  return plano.grupamentos[idx];
}

export const EXERCICIOS_FOCO = 2;
export const EXERCICIOS_DEMAIS = 2;

export interface ExercicioDaSessao {
  exercicio: TreinoExercicioPlano;
  emFoco: boolean;
  /** 5º exercício — só se der tempo dentro dos 40 min. */
  extra: boolean;
}

/**
 * Monta a sessão a partir do banco de exercícios do plano: 2 do grupamento
 * em foco + 2 dos demais (distribuídos em rodízio entre eles, na ordem do
 * plano) + um 5º opcional — o próximo do foco que sobrou, senão o próximo
 * dos demais.
 */
export function selecionarExerciciosDaSessao(plano: TreinoPlano, grupamentoFoco: string): ExercicioDaSessao[] {
  const doFoco = plano.exercicios.filter((e) => e.grupamento === grupamentoFoco);
  const filasDemais = plano.grupamentos
    .filter((g) => g !== grupamentoFoco)
    .map((g) => plano.exercicios.filter((e) => e.grupamento === g));

  const demaisEmRodizio: TreinoExercicioPlano[] = [];
  const maiorFila = Math.max(0, ...filasDemais.map((f) => f.length));
  for (let i = 0; i < maiorFila; i++) {
    for (const fila of filasDemais) if (fila[i]) demaisEmRodizio.push(fila[i]);
  }

  const principaisFoco = doFoco.slice(0, EXERCICIOS_FOCO);
  const principaisDemais = demaisEmRodizio.slice(0, EXERCICIOS_DEMAIS);
  const extra = doFoco[EXERCICIOS_FOCO] ?? demaisEmRodizio[EXERCICIOS_DEMAIS] ?? null;

  return [
    ...principaisFoco.map((exercicio) => ({ exercicio, emFoco: true, extra: false })),
    ...principaisDemais.map((exercicio) => ({ exercicio, emFoco: false, extra: false })),
    ...(extra ? [{ exercicio: extra, emFoco: extra.grupamento === grupamentoFoco, extra: true }] : []),
  ];
}

/**
 * Últimas execuções de cada exercício (antes da sessão atual) — contexto de
 * progressão de carga para a IA em `lib/insights/gemini-treino.ts`. Mais
 * recente primeiro, no máximo `limitePorExercicio` por nome de exercício.
 */
export function selectHistoricoRecente(
  sessoesAnteriores: TreinoSessao[],
  exercicios: string[],
  limitePorExercicio = 2,
): { exercicio: string; series: number; repeticoes: number; cargaKg: number; rpe: number; criadoEm: number }[] {
  const nomes = new Set(exercicios);
  const porExercicio = new Map<string, { exercicio: string; series: number; repeticoes: number; cargaKg: number; rpe: number; criadoEm: number }[]>();

  const todasAsSeries = sessoesAnteriores
    .flatMap((s) => s.series)
    .filter((s) => nomes.has(s.exercicio))
    .sort((a, b) => b.criadoEm - a.criadoEm);

  for (const serie of todasAsSeries) {
    const list = porExercicio.get(serie.exercicio) ?? [];
    if (list.length >= limitePorExercicio) continue;
    list.push({
      exercicio: serie.exercicio,
      series: serie.series,
      repeticoes: serie.repeticoes,
      cargaKg: serie.cargaKg,
      rpe: serie.rpe,
      criadoEm: serie.criadoEm,
    });
    porExercicio.set(serie.exercicio, list);
  }

  return [...porExercicio.values()].flat().sort((a, b) => b.criadoEm - a.criadoEm);
}

export interface TreinoMemoria {
  resumo: string;
  ultimoTreinoFeito: TreinoLetra | null;
  ultimoFocoFeito: string | null;
  proximoTreinoSugerido: TreinoLetra | null;
  proximoFocoSugerido: string | null;
  cargasChave: Record<string, { cargaKg: number; repeticoes: number; data: string }>;
  observacoesGerais: string | null;
  atualizadoEm: number;
}

export interface TreinoConversaMensagem {
  id: string;
  autor: "usuario" | "treinador";
  texto: string;
  seriesRegistradas?: TreinoSerieIdentificada[];
  criadoEm: number;
}

export function reduceTreinoMemoria(events: DecryptedEvent[]): TreinoMemoria | null {
  let memoria: TreinoMemoria | null = null;
  for (const event of events) {
    if (event.type === "treino_memoria_atualizada") {
      memoria = {
        resumo: event.resumo,
        ultimoTreinoFeito: event.ultimoTreinoFeito ?? null,
        ultimoFocoFeito: event.ultimoFocoFeito ?? null,
        proximoTreinoSugerido: event.proximoTreinoSugerido ?? null,
        proximoFocoSugerido: event.proximoFocoSugerido ?? null,
        cargasChave: event.cargasChave ?? {},
        observacoesGerais: event.observacoesGerais ?? null,
        atualizadoEm: event.createdAt,
      };
    }
  }
  return memoria;
}

export function reduceTreinoMensagens(events: DecryptedEvent[]): TreinoConversaMensagem[] {
  const msgs: TreinoConversaMensagem[] = [];
  for (const event of events) {
    if (event.type === "treino_mensagem_registrada") {
      msgs.push({
        id: event.mensagemId,
        autor: event.autor,
        texto: event.texto,
        seriesRegistradas: event.seriesRegistradas,
        criadoEm: event.createdAt,
      });
    }
  }
  return msgs.sort((a, b) => a.criadoEm - b.criadoEm);
}

export function reduceTodosExerciciosRealizados(events: DecryptedEvent[]): {
  id: string;
  exercicio: string;
  grupamento: string | null;
  series: number;
  repeticoes: number;
  cargaKg: number;
  rpe: number;
  observacoes: string;
  data: string;
  criadoEm: number;
}[] {
  const lista: {
    id: string;
    exercicio: string;
    grupamento: string | null;
    series: number;
    repeticoes: number;
    cargaKg: number;
    rpe: number;
    observacoes: string;
    data: string;
    criadoEm: number;
  }[] = [];

  for (const event of events) {
    if (event.type === "workout_set") {
      lista.push({
        id: event.id,
        exercicio: event.Exercicio,
        grupamento: event.Grupamento ?? null,
        series: event.Series,
        repeticoes: event.Repeticoes,
        cargaKg: event.Carga_kg,
        rpe: event.RPE,
        observacoes: event.Observacoes,
        data: event.Data,
        criadoEm: event.createdAt,
      });
    }
  }

  return lista.sort((a, b) => b.criadoEm - a.criadoEm);
}
