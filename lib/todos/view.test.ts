import { describe, expect, it } from "vitest";
import {
  addDaysISO,
  applySortToSections,
  completedForView,
  countForView,
  dueColor,
  excludeDeleted,
  flatForView,
  formatDue,
  groupActive,
  sectionsForView,
  sortItems,
  viewKey,
  viewTitle,
  type TarefasView,
} from "./view";
import type { ListItem, TodoItem } from "@/lib/events/types";

const todo = (over: Partial<TodoItem>): TodoItem => ({
  id: over.id ?? "x",
  texto: over.texto ?? "t",
  concluido: over.concluido ?? false,
  prioridade: over.prioridade ?? 0,
  vencimento: over.vencimento ?? null,
  listaId: over.listaId ?? null,
  concluidoEm: over.concluidoEm ?? null,
  apagadoEm: over.apagadoEm ?? null,
  criadoEm: over.criadoEm ?? 0,
});

const today = "2026-07-23";

describe("addDaysISO", () => {
  it("soma e subtrai dias respeitando virada de mês", () => {
    expect(addDaysISO("2026-07-23", 1)).toBe("2026-07-24");
    expect(addDaysISO("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDaysISO("2026-07-23", -1)).toBe("2026-07-22");
  });
});

describe("formatDue", () => {
  it("rotula hoje/amanhã/ontem", () => {
    expect(formatDue("2026-07-23", today)).toBe("Hoje");
    expect(formatDue("2026-07-24", today)).toBe("Amanhã");
    expect(formatDue("2026-07-22", today)).toBe("Ontem");
  });
  it("formata datas distantes como dia + mês", () => {
    expect(formatDue("2026-08-01", today)).toBe("1 ago");
  });
});

describe("dueColor", () => {
  it("vermelho para atrasada, accent para hoje/futuro", () => {
    expect(dueColor("2026-07-22", today)).toBe("#f87171");
    expect(dueColor("2026-07-23", today)).toBe("#6ea8fe");
    expect(dueColor("2026-07-30", today)).toBe("#6ea8fe");
  });
});

describe("excludeDeleted", () => {
  it("remove tarefas com apagadoEm definido", () => {
    const todos = [todo({ id: "a" }), todo({ id: "b", apagadoEm: 5 })];
    expect(excludeDeleted(todos).map((t) => t.id)).toEqual(["a"]);
  });
});

describe("groupActive", () => {
  it("separa atrasadas, hoje, próximas e sem data; omite concluídas e seções vazias", () => {
    const todos = [
      todo({ id: "a", vencimento: "2026-07-20" }),
      todo({ id: "b", vencimento: "2026-07-23" }),
      todo({ id: "c", vencimento: "2026-07-30" }),
      todo({ id: "d", vencimento: null }),
      todo({ id: "e", vencimento: "2026-07-01", concluido: true }),
    ];
    const sections = groupActive(todos, today);
    expect(sections.map((s) => s.key)).toEqual(["atrasadas", "hoje", "proximas", "semdata"]);
    expect(sections.flatMap((s) => s.itens.map((t) => t.id))).toEqual(["a", "b", "c", "d"]);
  });

  it("ordena por prioridade decrescente dentro da seção sem data", () => {
    const todos = [
      todo({ id: "baixa", prioridade: 1, criadoEm: 1 }),
      todo({ id: "alta", prioridade: 3, criadoEm: 2 }),
    ];
    const semData = groupActive(todos, today).find((s) => s.key === "semdata");
    expect(semData?.itens.map((t) => t.id)).toEqual(["alta", "baixa"]);
  });
});

describe("sectionsForView", () => {
  const todos = [
    todo({ id: "atrasada", vencimento: "2026-07-20" }),
    todo({ id: "hoje", vencimento: "2026-07-23" }),
    todo({ id: "amanha", vencimento: "2026-07-24" }),
    todo({ id: "em5dias", vencimento: "2026-07-28" }),
    todo({ id: "em10dias", vencimento: "2026-08-02" }),
    todo({ id: "semdata" }),
    todo({ id: "inbox-item", listaId: null }),
    todo({ id: "lista-a-item", listaId: "a" }),
    todo({ id: "apagada", vencimento: "2026-07-23", apagadoEm: 999 }),
    todo({ id: "concluida", vencimento: "2026-07-23", concluido: true }),
  ];

  it("hoje inclui atrasadas + hoje, exclui futuras/sem data/apagadas/concluídas", () => {
    const ids = sectionsForView(todos, { type: "hoje" }, today).flatMap((s) => s.itens.map((t) => t.id));
    expect(ids.sort()).toEqual(["atrasada", "hoje"].sort());
  });

  it("amanha só traz a data de amanhã, em seção única", () => {
    const sections = sectionsForView(todos, { type: "amanha" }, today);
    expect(sections).toEqual([
      { key: "amanha", nome: "Amanhã", itens: [expect.objectContaining({ id: "amanha" })] },
    ]);
  });

  it("proximos7 cobre até today+7 e ainda mostra atrasadas", () => {
    const ids = sectionsForView(todos, { type: "proximos7" }, today).flatMap((s) =>
      s.itens.map((t) => t.id),
    );
    expect(ids).toContain("atrasada");
    expect(ids).toContain("hoje");
    expect(ids).toContain("amanha");
    expect(ids).toContain("em5dias");
    expect(ids).not.toContain("em10dias");
    expect(ids).not.toContain("semdata");
  });

  it("inbox só traz tarefas com listaId nulo", () => {
    const ids = sectionsForView(todos, { type: "inbox" }, today).flatMap((s) => s.itens.map((t) => t.id));
    expect(ids).toContain("inbox-item");
    expect(ids).not.toContain("lista-a-item");
  });

  it("lista só traz tarefas daquela lista", () => {
    const ids = sectionsForView(todos, { type: "lista", listaId: "a" }, today).flatMap((s) =>
      s.itens.map((t) => t.id),
    );
    expect(ids).toEqual(["lista-a-item"]);
  });

  it("concluido/lixeira não produzem seções (usam flatForView)", () => {
    expect(sectionsForView(todos, { type: "concluido" }, today)).toEqual([]);
    expect(sectionsForView(todos, { type: "lixeira" }, today)).toEqual([]);
  });
});

describe("flatForView", () => {
  const todos = [
    todo({ id: "ativa" }),
    todo({ id: "concluida-1", concluido: true, concluidoEm: 10 }),
    todo({ id: "concluida-2", concluido: true, concluidoEm: 20 }),
    todo({ id: "apagada-1", apagadoEm: 10 }),
    todo({ id: "apagada-2", apagadoEm: 20 }),
  ];

  it("concluido retorna só concluídas não apagadas, mais recentes primeiro", () => {
    expect(flatForView(todos, { type: "concluido" }).map((t) => t.id)).toEqual([
      "concluida-2",
      "concluida-1",
    ]);
  });

  it("lixeira retorna só apagadas, mais recentes primeiro", () => {
    expect(flatForView(todos, { type: "lixeira" }).map((t) => t.id)).toEqual([
      "apagada-2",
      "apagada-1",
    ]);
  });

  it("outras views retornam array vazio", () => {
    expect(flatForView(todos, { type: "hoje" })).toEqual([]);
  });
});

describe("completedForView", () => {
  const todos = [
    todo({ id: "inbox-done", listaId: null, concluido: true, concluidoEm: 5 }),
    todo({ id: "lista-a-done", listaId: "a", concluido: true, concluidoEm: 10 }),
    todo({ id: "lista-a-done-2", listaId: "a", concluido: true, concluidoEm: 20 }),
    todo({ id: "lista-a-ativa", listaId: "a" }),
    todo({ id: "apagada-mas-concluida", listaId: "a", concluido: true, concluidoEm: 30, apagadoEm: 40 }),
  ];

  it("inbox só traz concluídas da caixa de entrada", () => {
    expect(completedForView(todos, { type: "inbox" }).map((t) => t.id)).toEqual(["inbox-done"]);
  });

  it("lista traz concluídas daquela lista, mais recentes primeiro, excluindo apagadas", () => {
    expect(completedForView(todos, { type: "lista", listaId: "a" }).map((t) => t.id)).toEqual([
      "lista-a-done-2",
      "lista-a-done",
    ]);
  });

  it("smart views por data não têm seção própria de concluído", () => {
    expect(completedForView(todos, { type: "hoje" })).toEqual([]);
  });
});

describe("countForView", () => {
  it("bate com o total de itens da view", () => {
    const todos = [todo({ id: "a", vencimento: today }), todo({ id: "b", vencimento: today })];
    expect(countForView(todos, { type: "hoje" }, today)).toBe(2);
  });

  it("conta concluídas/apagadas via flatForView", () => {
    const todos = [todo({ id: "a", concluido: true, concluidoEm: 1 })];
    expect(countForView(todos, { type: "concluido" }, today)).toBe(1);
    expect(countForView(todos, { type: "lixeira" }, today)).toBe(0);
  });
});

describe("viewTitle / viewKey", () => {
  const lists: ListItem[] = [{ id: "a", nome: "Trabalho", cor: "#fff", criadoEm: 1 }];

  it("retorna os títulos esperados", () => {
    const cases: [TarefasView, string][] = [
      [{ type: "hoje" }, "Hoje"],
      [{ type: "amanha" }, "Amanhã"],
      [{ type: "proximos7" }, "Próximos 7 dias"],
      [{ type: "inbox" }, "Caixa de Entrada"],
      [{ type: "concluido" }, "Concluído"],
      [{ type: "lixeira" }, "Lixeira"],
      [{ type: "lista", listaId: "a" }, "Trabalho"],
    ];
    for (const [view, expected] of cases) expect(viewTitle(view, lists)).toBe(expected);
  });

  it("lista com id desconhecido cai para rótulo genérico", () => {
    expect(viewTitle({ type: "lista", listaId: "fantasma" }, lists)).toBe("Lista");
  });

  it("viewKey distingue listas diferentes", () => {
    expect(viewKey({ type: "lista", listaId: "a" })).toBe("lista:a");
    expect(viewKey({ type: "hoje" })).toBe("hoje");
  });
});

describe("sortItems", () => {
  const items = [
    todo({ id: "b", texto: "Banana", prioridade: 1, vencimento: "2026-08-01", criadoEm: 20 }),
    todo({ id: "a", texto: "Abacaxi", prioridade: 3, vencimento: "2026-07-25", criadoEm: 10 }),
    todo({ id: "c", texto: "Cereja", prioridade: 0, vencimento: null, criadoEm: 30 }),
  ];

  it("ordena por prioridade, maior primeiro por padrão (desc)", () => {
    expect(sortItems(items, "prioridade", "desc").map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("inverte com direction asc", () => {
    expect(sortItems(items, "prioridade", "asc").map((t) => t.id)).toEqual(["c", "b", "a"]);
  });

  it("ordena por vencimento, sem data vai para o fim em asc", () => {
    expect(sortItems(items, "vencimento", "asc").map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("ordena por criação", () => {
    expect(sortItems(items, "criacao", "asc").map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("ordena por título (alfabético pt-BR)", () => {
    expect(sortItems(items, "titulo", "asc").map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("não muta o array original", () => {
    const copy = [...items];
    sortItems(items, "titulo", "desc");
    expect(items).toEqual(copy);
  });
});

describe("applySortToSections", () => {
  it("reordena os itens de cada seção preservando a estrutura de seções", () => {
    const sections = [
      {
        key: "s1",
        nome: "Seção 1",
        itens: [todo({ id: "b", texto: "Banana" }), todo({ id: "a", texto: "Abacaxi" })],
      },
    ];
    const sorted = applySortToSections(sections, "titulo", "asc");
    expect(sorted[0].key).toBe("s1");
    expect(sorted[0].itens.map((t) => t.id)).toEqual(["a", "b"]);
  });
});
