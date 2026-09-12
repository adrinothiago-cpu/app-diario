import { describe, expect, it } from "vitest";
import { reduceTodos } from "./todo-store";
import type { DecryptedEvent, TodoPriority } from "./types";

const created = (
  id: string,
  todoId: string,
  texto: string,
  createdAt: number,
  extra: { prioridade?: TodoPriority; vencimento?: string | null; listaId?: string | null } = {},
): DecryptedEvent => ({ type: "todo_created", todoId, texto, ...extra, id, createdAt });

const toggled = (
  id: string,
  todoId: string,
  concluido: boolean,
  createdAt: number,
): DecryptedEvent => ({ type: "todo_toggled", todoId, concluido, id, createdAt });

const updated = (
  id: string,
  todoId: string,
  patch: {
    texto?: string;
    prioridade?: TodoPriority;
    vencimento?: string | null;
    listaId?: string | null;
  },
  createdAt: number,
): DecryptedEvent => ({ type: "todo_updated", todoId, ...patch, id, createdAt });

const deleted = (id: string, todoId: string, createdAt: number): DecryptedEvent => ({
  type: "todo_deleted",
  todoId,
  id,
  createdAt,
});

const restored = (id: string, todoId: string, createdAt: number): DecryptedEvent => ({
  type: "todo_restored",
  todoId,
  id,
  createdAt,
});

describe("reduceTodos", () => {
  it("cria um item com defaults de prioridade, vencimento e lista", () => {
    const todos = reduceTodos([created("evt_1", "a", "Comprar leite", 1)]);
    expect(todos).toEqual([
      {
        id: "a",
        texto: "Comprar leite",
        concluido: false,
        prioridade: 0,
        vencimento: null,
        listaId: null,
        concluidoEm: null,
        apagadoEm: null,
        criadoEm: 1,
      },
    ]);
  });

  it("preserva prioridade, vencimento e lista informados na criação", () => {
    const todos = reduceTodos([
      created("evt_1", "a", "Prova", 1, { prioridade: 3, vencimento: "2026-08-01", listaId: "faculdade" }),
    ]);
    expect(todos[0].prioridade).toBe(3);
    expect(todos[0].vencimento).toBe("2026-08-01");
    expect(todos[0].listaId).toBe("faculdade");
  });

  it("aplica toggle sobre um item existente e registra concluidoEm", () => {
    const events = [created("evt_1", "a", "X", 1), toggled("evt_2", "a", true, 2)];
    const todo = reduceTodos(events)[0];
    expect(todo.concluido).toBe(true);
    expect(todo.concluidoEm).toBe(2);
  });

  it("limpa concluidoEm ao reabrir a tarefa", () => {
    const events = [
      created("evt_1", "a", "X", 1),
      toggled("evt_2", "a", true, 2),
      toggled("evt_3", "a", false, 3),
    ];
    const todo = reduceTodos(events)[0];
    expect(todo.concluido).toBe(false);
    expect(todo.concluidoEm).toBeNull();
  });

  it("aplica patch parcial de prioridade sem tocar no vencimento ou lista", () => {
    const events = [
      created("evt_1", "a", "X", 1, { vencimento: "2026-08-01", listaId: "casa" }),
      updated("evt_2", "a", { prioridade: 2 }, 2),
    ];
    const todo = reduceTodos(events)[0];
    expect(todo.prioridade).toBe(2);
    expect(todo.vencimento).toBe("2026-08-01");
    expect(todo.listaId).toBe("casa");
  });

  it("limpa o vencimento quando o patch traz vencimento: null", () => {
    const events = [
      created("evt_1", "a", "X", 1, { vencimento: "2026-08-01" }),
      updated("evt_2", "a", { vencimento: null }, 2),
    ];
    expect(reduceTodos(events)[0].vencimento).toBeNull();
  });

  it("move a tarefa de lista via patch de listaId", () => {
    const events = [
      created("evt_1", "a", "X", 1, { listaId: "trabalho" }),
      updated("evt_2", "a", { listaId: "pessoal" }, 2),
    ];
    expect(reduceTodos(events)[0].listaId).toBe("pessoal");
  });

  it("todo_deleted marca apagadoEm sem remover o item (soft delete)", () => {
    const events = [created("evt_1", "a", "X", 1), deleted("evt_2", "a", 2)];
    const todos = reduceTodos(events);
    expect(todos).toHaveLength(1);
    expect(todos[0].apagadoEm).toBe(2);
  });

  it("todo_restored limpa apagadoEm", () => {
    const events = [
      created("evt_1", "a", "X", 1),
      deleted("evt_2", "a", 2),
      restored("evt_3", "a", 3),
    ];
    expect(reduceTodos(events)[0].apagadoEm).toBeNull();
  });

  it("ignora update/toggle/delete/restore de um todoId inexistente", () => {
    expect(reduceTodos([toggled("evt_1", "fantasma", true, 1)])).toEqual([]);
    expect(reduceTodos([updated("evt_1", "fantasma", { prioridade: 3 }, 1)])).toEqual([]);
    expect(reduceTodos([deleted("evt_1", "fantasma", 1)])).toEqual([]);
    expect(reduceTodos([restored("evt_1", "fantasma", 1)])).toEqual([]);
  });

  it("ordena o resultado por criadoEm, independente da ordem dos eventos", () => {
    const events = [created("evt_2", "b", "segundo", 5), created("evt_1", "a", "primeiro", 1)];
    expect(reduceTodos(events).map((t) => t.texto)).toEqual(["primeiro", "segundo"]);
  });
});
