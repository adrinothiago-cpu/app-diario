import { describe, expect, it } from "vitest";
import { reduceLists } from "./lists-store";
import type { DecryptedEvent } from "./types";

const created = (id: string, listaId: string, nome: string, cor: string, createdAt: number): DecryptedEvent => ({
  type: "list_created",
  listaId,
  nome,
  cor,
  id,
  createdAt,
});

const renamed = (id: string, listaId: string, nome: string, createdAt: number): DecryptedEvent => ({
  type: "list_renamed",
  listaId,
  nome,
  id,
  createdAt,
});

const recolored = (id: string, listaId: string, cor: string, createdAt: number): DecryptedEvent => ({
  type: "list_recolored",
  listaId,
  cor,
  id,
  createdAt,
});

const removed = (id: string, listaId: string, createdAt: number): DecryptedEvent => ({
  type: "list_deleted",
  listaId,
  id,
  createdAt,
});

describe("reduceLists", () => {
  it("cria uma lista", () => {
    const lists = reduceLists([created("evt_1", "trabalho", "Trabalho", "#6ea8fe", 1)]);
    expect(lists).toEqual([{ id: "trabalho", nome: "Trabalho", cor: "#6ea8fe", criadoEm: 1 }]);
  });

  it("aplica rename e recolor", () => {
    const events = [
      created("evt_1", "a", "Original", "#f87171", 1),
      renamed("evt_2", "a", "Renomeada", 2),
      recolored("evt_3", "a", "#22c55e", 3),
    ];
    const list = reduceLists(events)[0];
    expect(list.nome).toBe("Renomeada");
    expect(list.cor).toBe("#22c55e");
  });

  it("remove a lista com list_deleted", () => {
    const events = [created("evt_1", "a", "X", "#fff", 1), removed("evt_2", "a", 2)];
    expect(reduceLists(events)).toEqual([]);
  });

  it("ignora rename/recolor/delete de uma lista inexistente", () => {
    expect(reduceLists([renamed("evt_1", "fantasma", "X", 1)])).toEqual([]);
    expect(reduceLists([recolored("evt_1", "fantasma", "#000", 1)])).toEqual([]);
    expect(reduceLists([removed("evt_1", "fantasma", 1)])).toEqual([]);
  });

  it("ordena por criadoEm", () => {
    const events = [
      created("evt_2", "b", "segunda", "#000", 5),
      created("evt_1", "a", "primeira", "#fff", 1),
    ];
    expect(reduceLists(events).map((l) => l.nome)).toEqual(["primeira", "segunda"]);
  });
});
