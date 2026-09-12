/**
 * Reduz o log de eventos brutos no estado atual das Listas próprias do
 * usuário (equivalente às "Lists" do TickTick). Mesma disciplina do
 * todo-store: nenhuma edição in-place, só reconstrução a partir de deltas.
 */
import type { DecryptedEvent, ListItem } from "./types";

export function reduceLists(events: DecryptedEvent[]): ListItem[] {
  const lists = new Map<string, ListItem>();

  for (const event of events) {
    if (event.type === "list_created") {
      lists.set(event.listaId, {
        id: event.listaId,
        nome: event.nome,
        cor: event.cor,
        criadoEm: event.createdAt,
      });
    } else if (event.type === "list_renamed") {
      const existing = lists.get(event.listaId);
      if (existing) existing.nome = event.nome;
    } else if (event.type === "list_recolored") {
      const existing = lists.get(event.listaId);
      if (existing) existing.cor = event.cor;
    } else if (event.type === "list_deleted") {
      lists.delete(event.listaId);
    }
  }

  return [...lists.values()].sort((a, b) => a.criadoEm - b.criadoEm);
}
