/**
 * Reduz o log de eventos brutos (já ordenado por createdAt pelo event-store)
 * no estado atual dos itens de compra. Puramente derivado — nunca é a fonte
 * de verdade, só uma projeção recalculável a qualquer momento.
 *
 * Retorna TODOS os itens, inclusive os apagados (soft delete via
 * `apagadoEm`) — quem consome decide o que exibir, igual a `todo-store.ts`.
 */
import type { DecryptedEvent, PurchaseItem } from "./types";

export function reducePurchases(events: DecryptedEvent[]): PurchaseItem[] {
  const purchases = new Map<string, PurchaseItem>();

  for (const event of events) {
    if (event.type === "purchase_created") {
      purchases.set(event.purchaseId, {
        id: event.purchaseId,
        nome: event.nome,
        quantidade: event.quantidade ?? null,
        observacao: event.observacao ?? null,
        comprado: false,
        compradoEm: null,
        apagadoEm: null,
        criadoEm: event.createdAt,
        incluirBusca: event.incluirBusca ?? false,
        precos: [],
        precosModeloUsado: null,
        precosBuscadoEm: null,
      });
    } else if (event.type === "purchase_updated") {
      const existing = purchases.get(event.purchaseId);
      if (existing) {
        if (event.nome !== undefined) existing.nome = event.nome;
        if ("quantidade" in event) existing.quantidade = event.quantidade ?? null;
        if ("observacao" in event) existing.observacao = event.observacao ?? null;
        if (event.incluirBusca !== undefined) existing.incluirBusca = event.incluirBusca;
      }
    } else if (event.type === "purchase_toggled") {
      const existing = purchases.get(event.purchaseId);
      if (existing) {
        existing.comprado = event.comprado;
        existing.compradoEm = event.comprado ? event.createdAt : null;
      }
    } else if (event.type === "purchase_deleted") {
      const existing = purchases.get(event.purchaseId);
      if (existing) existing.apagadoEm = event.createdAt;
    } else if (event.type === "purchase_restored") {
      const existing = purchases.get(event.purchaseId);
      if (existing) existing.apagadoEm = null;
    } else if (event.type === "purchase_price_search_updated") {
      const existing = purchases.get(event.purchaseId);
      if (existing) {
        existing.precos = event.resultados;
        existing.precosModeloUsado = event.modeloUsado ?? null;
        existing.precosBuscadoEm = event.createdAt;
      }
    }
  }

  return [...purchases.values()].sort((a, b) => a.criadoEm - b.criadoEm);
}
