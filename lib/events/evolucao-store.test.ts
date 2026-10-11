import { describe, expect, it } from "vitest";
import { reduceEvolucaoClassificacoes, reduceEvolucaoTopicos } from "./evolucao-store";
import type { DecryptedEvent, EvolucaoCriterio } from "./types";

const criado = (
  id: string,
  topicoId: string,
  titulo: string,
  createdAt: number,
  descricao?: string,
): DecryptedEvent => ({ type: "evolucao_topico_criado", topicoId, titulo, descricao, id, createdAt });

const renomeado = (
  id: string,
  topicoId: string,
  patch: { titulo?: string; descricao?: string },
  createdAt: number,
): DecryptedEvent => ({ type: "evolucao_topico_renomeado", topicoId, ...patch, id, createdAt });

const arquivado = (id: string, topicoId: string, createdAt: number): DecryptedEvent => ({
  type: "evolucao_topico_arquivado",
  topicoId,
  id,
  createdAt,
});

const reaberto = (id: string, topicoId: string, createdAt: number): DecryptedEvent => ({
  type: "evolucao_topico_reaberto",
  topicoId,
  id,
  createdAt,
});

const rodada = (
  id: string,
  topicoId: string,
  criterios: EvolucaoCriterio[],
  resumo: string,
  createdAt: number,
): DecryptedEvent => ({
  type: "evolucao_rodada_registrada",
  topicoId,
  criterios,
  resumo,
  tendencia: "sem_dados_suficientes",
  baseadoEmEntradas: criterios.length,
  id,
  createdAt,
});

const mensagem = (
  id: string,
  topicoId: string,
  autor: "usuario" | "ia",
  texto: string,
  createdAt: number,
): DecryptedEvent => ({ type: "evolucao_mensagem_registrada", topicoId, autor, texto, id, createdAt });

const classificada = (
  id: string,
  entryId: string,
  topicoId: string | null,
  versaoTopicos: string,
  createdAt: number,
): DecryptedEvent => ({ type: "evolucao_entrada_classificada", entryId, topicoId, versaoTopicos, id, createdAt });

describe("reduceEvolucaoTopicos", () => {
  it("cria um tópico com descrição opcional", () => {
    const topicos = reduceEvolucaoTopicos([criado("e1", "t1", "Relação com a Rosângela", 1, "colega de trabalho")]);
    expect(topicos).toEqual([
      {
        id: "t1",
        titulo: "Relação com a Rosângela",
        descricao: "colega de trabalho",
        criadoEm: 1,
        arquivadoEm: null,
        rodadas: [],
        mensagens: [],
      },
    ]);
  });

  it("aplica patch parcial no renomeio sem tocar em campo ausente", () => {
    const events = [
      criado("e1", "t1", "Título antigo", 1, "contexto antigo"),
      renomeado("e2", "t1", { titulo: "Título novo" }, 2),
    ];
    const topico = reduceEvolucaoTopicos(events)[0];
    expect(topico.titulo).toBe("Título novo");
    expect(topico.descricao).toBe("contexto antigo");
  });

  it("arquiva e reabre", () => {
    const events = [criado("e1", "t1", "X", 1), arquivado("e2", "t1", 2)];
    expect(reduceEvolucaoTopicos(events)[0].arquivadoEm).toBe(2);

    const reabertos = reduceEvolucaoTopicos([...events, reaberto("e3", "t1", 3)]);
    expect(reabertos[0].arquivadoEm).toBeNull();
  });

  it("acumula rodadas em ordem cronológica, sem sobrescrever (diferente de mood insights)", () => {
    const c1: EvolucaoCriterio[] = [{ texto: "Gera resultado real?", valor: false }];
    const c2: EvolucaoCriterio[] = [{ texto: "Gera resultado real?", valor: true }];
    const events = [
      criado("e1", "t1", "X", 1),
      rodada("e2", "t1", c1, "Primeira rodada", 2),
      rodada("e3", "t1", c2, "Segunda rodada", 3),
    ];
    const topico = reduceEvolucaoTopicos(events)[0];
    expect(topico.rodadas).toHaveLength(2);
    expect(topico.rodadas[0].resumo).toBe("Primeira rodada");
    expect(topico.rodadas[1].resumo).toBe("Segunda rodada");
    expect(topico.rodadas[1].criterios).toEqual(c2);
  });

  it("ignora eventos de um topicoId inexistente", () => {
    expect(reduceEvolucaoTopicos([arquivado("e1", "fantasma", 1)])).toEqual([]);
    expect(reduceEvolucaoTopicos([rodada("e1", "fantasma", [], "x", 1)])).toEqual([]);
  });

  it("acumula mensagens do chat em ordem cronológica", () => {
    const events = [
      criado("e1", "t1", "X", 1),
      mensagem("e2", "t1", "usuario", "oi", 2),
      mensagem("e3", "t1", "ia", "olá", 3),
    ];
    const topico = reduceEvolucaoTopicos(events)[0];
    expect(topico.mensagens).toEqual([
      { autor: "usuario", texto: "oi", criadoEm: 2 },
      { autor: "ia", texto: "olá", criadoEm: 3 },
    ]);
  });

  it("ignora mensagem de um topicoId inexistente", () => {
    expect(reduceEvolucaoTopicos([mensagem("e1", "fantasma", "usuario", "oi", 1)])).toEqual([]);
  });

  it("ordena o resultado por criadoEm, independente da ordem dos eventos", () => {
    const events = [criado("e2", "b", "segundo", 5), criado("e1", "a", "primeiro", 1)];
    expect(reduceEvolucaoTopicos(events).map((t) => t.titulo)).toEqual(["primeiro", "segundo"]);
  });
});

describe("reduceEvolucaoClassificacoes", () => {
  it("retorna lista plana na ordem do log", () => {
    const events = [
      classificada("e1", "entry-1", "t1", "aaaaaaaa", 1),
      classificada("e2", "entry-2", null, "aaaaaaaa", 2),
    ];
    expect(reduceEvolucaoClassificacoes(events)).toEqual([
      { entryId: "entry-1", topicoId: "t1", versaoTopicos: "aaaaaaaa", criadoEm: 1 },
      { entryId: "entry-2", topicoId: null, versaoTopicos: "aaaaaaaa", criadoEm: 2 },
    ]);
  });

  it("ignora eventos de outros tipos", () => {
    expect(reduceEvolucaoClassificacoes([criado("e1", "t1", "X", 1)])).toEqual([]);
  });
});
