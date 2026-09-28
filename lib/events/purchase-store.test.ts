import { describe, expect, it } from "vitest";
import { reducePurchases } from "./purchase-store";
import type { DecryptedEvent, PurchasePriceResult } from "./types";

const created = (
  id: string,
  purchaseId: string,
  nome: string,
  createdAt: number,
  extra: { quantidade?: number | null; observacao?: string | null; incluirBusca?: boolean } = {},
): DecryptedEvent => ({ type: "purchase_created", purchaseId, nome, ...extra, id, createdAt });

const updated = (
  id: string,
  purchaseId: string,
  patch: { nome?: string; quantidade?: number | null; observacao?: string | null; incluirBusca?: boolean },
  createdAt: number,
): DecryptedEvent => ({ type: "purchase_updated", purchaseId, ...patch, id, createdAt });

const toggled = (id: string, purchaseId: string, comprado: boolean, createdAt: number): DecryptedEvent => ({
  type: "purchase_toggled",
  purchaseId,
  comprado,
  id,
  createdAt,
});

const deleted = (id: string, purchaseId: string, createdAt: number): DecryptedEvent => ({
  type: "purchase_deleted",
  purchaseId,
  id,
  createdAt,
});

const restored = (id: string, purchaseId: string, createdAt: number): DecryptedEvent => ({
  type: "purchase_restored",
  purchaseId,
  id,
  createdAt,
});

const priceSearchUpdated = (
  id: string,
  purchaseId: string,
  resultados: PurchasePriceResult[],
  createdAt: number,
  modeloUsado?: string,
): DecryptedEvent => ({
  type: "purchase_price_search_updated",
  purchaseId,
  resultados,
  modeloUsado,
  id,
  createdAt,
});

describe("reducePurchases", () => {
  it("cria um item com defaults de quantidade e observação", () => {
    const purchases = reducePurchases([created("evt_1", "a", "Detergente", 1)]);
    expect(purchases).toEqual([
      {
        id: "a",
        nome: "Detergente",
        quantidade: null,
        observacao: null,
        comprado: false,
        compradoEm: null,
        apagadoEm: null,
        criadoEm: 1,
        incluirBusca: false,
        precos: [],
        precosModeloUsado: null,
        precosBuscadoEm: null,
      },
    ]);
  });

  it("marca incluirBusca quando informado na criação, e mantém default false quando ausente", () => {
    const purchases = reducePurchases([
      created("evt_1", "a", "Marcado", 1, { incluirBusca: true }),
      created("evt_2", "b", "Não marcado", 2),
    ]);
    expect(purchases[0].incluirBusca).toBe(true);
    expect(purchases[1].incluirBusca).toBe(false);
  });

  it("alterna incluirBusca via purchase_updated sem afetar outros campos", () => {
    const events = [
      created("evt_1", "a", "X", 1, { quantidade: 2 }),
      updated("evt_2", "a", { incluirBusca: true }, 2),
    ];
    const purchase = reducePurchases(events)[0];
    expect(purchase.incluirBusca).toBe(true);
    expect(purchase.quantidade).toBe(2);
  });

  it("preserva quantidade e observação informadas na criação", () => {
    const purchases = reducePurchases([
      created("evt_1", "a", "Fone de ouvido", 1, { quantidade: 2, observacao: "com cancelamento de ruído" }),
    ]);
    expect(purchases[0].quantidade).toBe(2);
    expect(purchases[0].observacao).toBe("com cancelamento de ruído");
  });

  it("aplica patch parcial sem tocar nos campos ausentes", () => {
    const events = [
      created("evt_1", "a", "X", 1, { quantidade: 1, observacao: "azul" }),
      updated("evt_2", "a", { nome: "Y" }, 2),
    ];
    const purchase = reducePurchases(events)[0];
    expect(purchase.nome).toBe("Y");
    expect(purchase.quantidade).toBe(1);
    expect(purchase.observacao).toBe("azul");
  });

  it("aplica toggle e registra compradoEm", () => {
    const events = [created("evt_1", "a", "X", 1), toggled("evt_2", "a", true, 2)];
    const purchase = reducePurchases(events)[0];
    expect(purchase.comprado).toBe(true);
    expect(purchase.compradoEm).toBe(2);
  });

  it("limpa compradoEm ao desmarcar", () => {
    const events = [
      created("evt_1", "a", "X", 1),
      toggled("evt_2", "a", true, 2),
      toggled("evt_3", "a", false, 3),
    ];
    expect(reducePurchases(events)[0].compradoEm).toBeNull();
  });

  it("purchase_deleted marca apagadoEm sem remover o item (soft delete)", () => {
    const events = [created("evt_1", "a", "X", 1), deleted("evt_2", "a", 2)];
    const purchases = reducePurchases(events);
    expect(purchases).toHaveLength(1);
    expect(purchases[0].apagadoEm).toBe(2);
  });

  it("purchase_restored limpa apagadoEm", () => {
    const events = [created("evt_1", "a", "X", 1), deleted("evt_2", "a", 2), restored("evt_3", "a", 3)];
    expect(reducePurchases(events)[0].apagadoEm).toBeNull();
  });

  it("guarda o resultado mais recente da busca de preço", () => {
    const primeira: PurchasePriceResult[] = [{ loja: "Loja A", preco: 100, url: "https://a.example" }];
    const segunda: PurchasePriceResult[] = [
      { loja: "Loja B", preco: 90, url: "https://b.example" },
      { loja: "Loja A", preco: 100, url: "https://a.example" },
    ];
    const events = [
      created("evt_1", "a", "X", 1),
      priceSearchUpdated("evt_2", "a", primeira, 2, "gemini-3.8-flash"),
      priceSearchUpdated("evt_3", "a", segunda, 3, "gemini-3.7-flash"),
    ];
    const purchase = reducePurchases(events)[0];
    expect(purchase.precos).toEqual(segunda);
    expect(purchase.precosModeloUsado).toBe("gemini-3.7-flash");
    expect(purchase.precosBuscadoEm).toBe(3);
  });

  it("ignora update/toggle/delete/restore/preço de um purchaseId inexistente", () => {
    expect(reducePurchases([toggled("evt_1", "fantasma", true, 1)])).toEqual([]);
    expect(reducePurchases([updated("evt_1", "fantasma", { nome: "x" }, 1)])).toEqual([]);
    expect(reducePurchases([deleted("evt_1", "fantasma", 1)])).toEqual([]);
    expect(reducePurchases([restored("evt_1", "fantasma", 1)])).toEqual([]);
    expect(reducePurchases([priceSearchUpdated("evt_1", "fantasma", [], 1)])).toEqual([]);
  });

  it("ordena o resultado por criadoEm, independente da ordem dos eventos", () => {
    const events = [created("evt_2", "b", "segundo", 5), created("evt_1", "a", "primeiro", 1)];
    expect(reducePurchases(events).map((p) => p.nome)).toEqual(["primeiro", "segundo"]);
  });
});
