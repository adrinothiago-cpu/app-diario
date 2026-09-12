/**
 * Helpers puros de apresentação da lista de tarefas (estilo TickTick):
 * cores de prioridade, formatação de datas em pt-BR, seleção/agrupamento por
 * "view" da barra lateral (smart lists, listas próprias, concluído, lixeira).
 * Sem React/DOM aqui — toda a lógica é testável isoladamente.
 */
import type { ListItem, TodoItem, TodoPriority } from "@/lib/events/types";

export const PRIORITIES: Record<TodoPriority, { label: string; color: string }> = {
  3: { label: "Alta", color: "#f87171" },
  2: { label: "Média", color: "#fbbf24" },
  1: { label: "Baixa", color: "#6ea8fe" },
  0: { label: "Nenhuma", color: "#58617a" },
};

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Data local no formato ISO (YYYY-MM-DD), sem deslocar por fuso. */
export function todayISO(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Soma/subtrai dias a uma data ISO local, sem deslocar por fuso. */
export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mm}-${dd}`;
}

export function nextPriority(p: TodoPriority): TodoPriority {
  return ((p + 1) % 4) as TodoPriority;
}

/** "Hoje" / "Amanhã" / "Ontem" / "23 jul" — comparando strings ISO já normalizadas. */
export function formatDue(iso: string, today: string): string {
  if (iso === today) return "Hoje";
  const [y, m, d] = iso.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  const diff = Math.round(
    (new Date(y, m - 1, d).getTime() - new Date(ty, tm - 1, td).getTime()) / 86_400_000,
  );
  if (diff === 1) return "Amanhã";
  if (diff === -1) return "Ontem";
  return `${d} ${MESES[m - 1]}`;
}

/** Vermelho se atrasada, azul-accent para hoje/futuro. */
export function dueColor(iso: string, today: string): string {
  return iso < today ? "#f87171" : "#6ea8fe";
}

/** Exclui tarefas na lixeira (soft-deleted). Base de qualquer view "normal". */
export function excludeDeleted(todos: TodoItem[]): TodoItem[] {
  return todos.filter((t) => t.apagadoEm === null);
}

export interface TodoSection {
  key: string;
  nome: string;
  itens: TodoItem[];
}

const byPriority = (a: TodoItem, b: TodoItem) =>
  b.prioridade - a.prioridade || a.criadoEm - b.criadoEm;

const byDate = (a: TodoItem, b: TodoItem) =>
  (a.vencimento ?? "").localeCompare(b.vencimento ?? "") || b.prioridade - a.prioridade;

/** Agrupa tarefas ativas (não concluídas) em seções inteligentes; só as não-vazias. */
export function groupActive(todos: TodoItem[], today: string): TodoSection[] {
  const active = todos.filter((t) => !t.concluido);
  const sections: TodoSection[] = [
    {
      key: "atrasadas",
      nome: "Atrasadas",
      itens: active.filter((t) => t.vencimento && t.vencimento < today).sort(byPriority),
    },
    {
      key: "hoje",
      nome: "Hoje",
      itens: active.filter((t) => t.vencimento === today).sort(byPriority),
    },
    {
      key: "proximas",
      nome: "Próximas",
      itens: active.filter((t) => t.vencimento && t.vencimento > today).sort(byDate),
    },
    {
      key: "semdata",
      nome: "Sem data",
      itens: active.filter((t) => !t.vencimento).sort(byPriority),
    },
  ];
  return sections.filter((s) => s.itens.length > 0);
}

/**
 * Views da barra lateral. `hoje`/`amanha`/`proximos7`/`inbox` são "smart
 * lists" (agregam por data ou pela lista padrão); `lista` é uma lista
 * própria do usuário; `concluido`/`lixeira` são globais (todas as listas).
 */
export type TarefasView =
  | { type: "hoje" }
  | { type: "amanha" }
  | { type: "proximos7" }
  | { type: "inbox" }
  | { type: "lista"; listaId: string }
  | { type: "concluido" }
  | { type: "lixeira" };

export function viewKey(view: TarefasView): string {
  return view.type === "lista" ? `lista:${view.listaId}` : view.type;
}

export function viewTitle(view: TarefasView, lists: ListItem[]): string {
  switch (view.type) {
    case "hoje":
      return "Hoje";
    case "amanha":
      return "Amanhã";
    case "proximos7":
      return "Próximos 7 dias";
    case "inbox":
      return "Caixa de Entrada";
    case "concluido":
      return "Concluído";
    case "lixeira":
      return "Lixeira";
    case "lista":
      return lists.find((l) => l.id === view.listaId)?.nome ?? "Lista";
  }
}

/**
 * Seções para as views "de lista" (smart lists por data + listas próprias).
 * `concluido`/`lixeira` não passam por aqui — são exibidas como lista plana
 * pelo chamador (ver `flatForView`).
 */
export function sectionsForView(todos: TodoItem[], view: TarefasView, today: string): TodoSection[] {
  const active = excludeDeleted(todos).filter((t) => !t.concluido);

  if (view.type === "hoje") {
    // Réplica do comportamento real do TickTick: "Hoje" também mostra atrasadas.
    const scoped = active.filter((t) => t.vencimento !== null && t.vencimento <= today);
    return groupActive(scoped, today);
  }
  if (view.type === "amanha") {
    const amanha = addDaysISO(today, 1);
    const itens = active.filter((t) => t.vencimento === amanha).sort(byPriority);
    return itens.length > 0 ? [{ key: "amanha", nome: "Amanhã", itens }] : [];
  }
  if (view.type === "proximos7") {
    const limite = addDaysISO(today, 7);
    const scoped = active.filter((t) => t.vencimento !== null && t.vencimento <= limite);
    return groupActive(scoped, today);
  }
  if (view.type === "inbox") {
    return groupActive(
      active.filter((t) => t.listaId === null),
      today,
    );
  }
  if (view.type === "lista") {
    return groupActive(
      active.filter((t) => t.listaId === view.listaId),
      today,
    );
  }
  // concluido/lixeira: sem seções, ver flatForView.
  return [];
}

/** Lista plana (sem seções) para as views "concluido" e "lixeira". */
export function flatForView(todos: TodoItem[], view: TarefasView): TodoItem[] {
  if (view.type === "lixeira") {
    return todos
      .filter((t) => t.apagadoEm !== null)
      .sort((a, b) => (b.apagadoEm ?? 0) - (a.apagadoEm ?? 0));
  }
  if (view.type === "concluido") {
    return excludeDeleted(todos)
      .filter((t) => t.concluido)
      .sort((a, b) => (b.concluidoEm ?? 0) - (a.concluidoEm ?? 0));
  }
  return [];
}

const byConcluidoDesc = (a: TodoItem, b: TodoItem) => (b.concluidoEm ?? 0) - (a.concluidoEm ?? 0);

/**
 * Seção "Concluído" dentro de uma view de lista (Caixa de Entrada / lista
 * própria), como no TickTick — escopo local, distinto da view global
 * "Concluído" da barra lateral. Smart views por data (hoje/amanhã/
 * próximos7) não têm essa seção própria: o item concluído global cobre esse
 * caso.
 */
export function completedForView(todos: TodoItem[], view: TarefasView): TodoItem[] {
  const done = excludeDeleted(todos).filter((t) => t.concluido);
  if (view.type === "inbox") return done.filter((t) => t.listaId === null).sort(byConcluidoDesc);
  if (view.type === "lista") return done.filter((t) => t.listaId === view.listaId).sort(byConcluidoDesc);
  return [];
}

/** Contador exibido ao lado do nome da view na barra lateral. */
export function countForView(todos: TodoItem[], view: TarefasView, today: string): number {
  if (view.type === "concluido" || view.type === "lixeira") {
    return flatForView(todos, view).length;
  }
  return sectionsForView(todos, view, today).reduce((sum, s) => sum + s.itens.length, 0);
}

/**
 * Ordenação explícita escolhida pelo usuário no cabeçalho ("Ordenar").
 * Sem seleção (null no chamador), cada seção usa seu critério padrão — ver
 * `groupActive`/`sectionsForView`.
 */
export type SortMode = "prioridade" | "vencimento" | "criacao" | "titulo";
export type SortDirection = "asc" | "desc";

export const SORT_MODE_LABELS: Record<SortMode, string> = {
  prioridade: "Prioridade",
  vencimento: "Data de vencimento",
  criacao: "Data de criação",
  titulo: "Título",
};

// Todos os comparadores representam ordem ASCENDENTE natural; `sortItems`
// inverte uniformemente quando direction === "desc".
const SORT_COMPARATORS: Record<SortMode, (a: TodoItem, b: TodoItem) => number> = {
  prioridade: (a, b) => a.prioridade - b.prioridade,
  vencimento: (a, b) => (a.vencimento ?? "9999-99-99").localeCompare(b.vencimento ?? "9999-99-99"),
  criacao: (a, b) => a.criadoEm - b.criadoEm,
  titulo: (a, b) => a.texto.localeCompare(b.texto, "pt-BR"),
};

export function sortItems(items: TodoItem[], mode: SortMode, direction: SortDirection): TodoItem[] {
  const sorted = [...items].sort(SORT_COMPARATORS[mode]);
  return direction === "desc" ? sorted.reverse() : sorted;
}

/** Substitui o critério de cada seção pelo escolhido pelo usuário, preservando os grupos. */
export function applySortToSections(
  sections: TodoSection[],
  mode: SortMode,
  direction: SortDirection,
): TodoSection[] {
  return sections.map((s) => ({ ...s, itens: sortItems(s.itens, mode, direction) }));
}
