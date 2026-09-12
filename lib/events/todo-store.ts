/**
 * Reduz o log de eventos brutos (já ordenado por createdAt pelo event-store)
 * no estado atual das tarefas. Puramente derivado — nunca é a fonte de
 * verdade, só uma projeção recalculável a qualquer momento.
 *
 * Retorna TODAS as tarefas, inclusive as apagadas (soft delete via
 * `apagadoEm`) — quem consome decide o que exibir (ver `lib/todos/view.ts`).
 */
import type { DecryptedEvent, TodoItem } from "./types";

export function reduceTodos(events: DecryptedEvent[]): TodoItem[] {
  const todos = new Map<string, TodoItem>();

  for (const event of events) {
    if (event.type === "todo_created") {
      todos.set(event.todoId, {
        id: event.todoId,
        texto: event.texto,
        concluido: false,
        prioridade: event.prioridade ?? 0,
        vencimento: event.vencimento ?? null,
        listaId: event.listaId ?? null,
        concluidoEm: null,
        apagadoEm: null,
        criadoEm: event.createdAt,
      });
    } else if (event.type === "todo_updated") {
      const existing = todos.get(event.todoId);
      if (existing) {
        // Só chaves presentes no patch são aplicadas.
        if (event.texto !== undefined) existing.texto = event.texto;
        if (event.prioridade !== undefined) existing.prioridade = event.prioridade;
        if ("vencimento" in event) existing.vencimento = event.vencimento ?? null;
        if ("listaId" in event) existing.listaId = event.listaId ?? null;
      }
    } else if (event.type === "todo_toggled") {
      const existing = todos.get(event.todoId);
      if (existing) {
        existing.concluido = event.concluido;
        existing.concluidoEm = event.concluido ? event.createdAt : null;
      }
    } else if (event.type === "todo_deleted") {
      const existing = todos.get(event.todoId);
      if (existing) existing.apagadoEm = event.createdAt;
    } else if (event.type === "todo_restored") {
      const existing = todos.get(event.todoId);
      if (existing) existing.apagadoEm = null;
    }
  }

  return [...todos.values()].sort((a, b) => a.criadoEm - b.criadoEm);
}
