/**
 * Reduz o log de eventos brutos no estado atual da seção Evolução.
 * Dois reducers: tópicos (com a linha do tempo completa de rodadas — ao
 * contrário do padrão "singleton por sobrescrita" de `mood-insights-store.ts`,
 * aqui as rodadas são ACUMULADAS) e classificações (lista plana, usada como
 * checkpoint incremental por `selectEntriesForClassification`).
 */
import type { DecryptedEvent, EvolucaoClassificacao, EvolucaoTopico } from "./types";

export function reduceEvolucaoTopicos(events: DecryptedEvent[]): EvolucaoTopico[] {
  const topicos = new Map<string, EvolucaoTopico>();

  for (const event of events) {
    if (event.type === "evolucao_topico_criado") {
      topicos.set(event.topicoId, {
        id: event.topicoId,
        titulo: event.titulo,
        descricao: event.descricao ?? null,
        criadoEm: event.createdAt,
        arquivadoEm: null,
        rodadas: [],
        mensagens: [],
      });
    } else if (event.type === "evolucao_topico_renomeado") {
      const existing = topicos.get(event.topicoId);
      if (existing) {
        if (event.titulo !== undefined) existing.titulo = event.titulo;
        if (event.descricao !== undefined) existing.descricao = event.descricao;
      }
    } else if (event.type === "evolucao_topico_arquivado") {
      const existing = topicos.get(event.topicoId);
      if (existing) existing.arquivadoEm = event.createdAt;
    } else if (event.type === "evolucao_topico_reaberto") {
      const existing = topicos.get(event.topicoId);
      if (existing) existing.arquivadoEm = null;
    } else if (event.type === "evolucao_rodada_registrada") {
      const existing = topicos.get(event.topicoId);
      if (existing) {
        existing.rodadas.push({
          criterios: event.criterios,
          resumo: event.resumo,
          tendencia: event.tendencia,
          baseadoEmEntradas: event.baseadoEmEntradas,
          modeloUsado: event.modeloUsado,
          criadoEm: event.createdAt,
        });
      }
    } else if (event.type === "evolucao_mensagem_registrada") {
      const existing = topicos.get(event.topicoId);
      if (existing) {
        existing.mensagens.push({
          autor: event.autor,
          texto: event.texto,
          criadoEm: event.createdAt,
        });
      }
    }
  }

  return [...topicos.values()].sort((a, b) => a.criadoEm - b.criadoEm);
}

export function reduceEvolucaoClassificacoes(events: DecryptedEvent[]): EvolucaoClassificacao[] {
  const out: EvolucaoClassificacao[] = [];
  for (const event of events) {
    if (event.type === "evolucao_entrada_classificada") {
      out.push({
        entryId: event.entryId,
        topicoId: event.topicoId,
        versaoTopicos: event.versaoTopicos,
        criadoEm: event.createdAt,
      });
    }
  }
  return out;
}
