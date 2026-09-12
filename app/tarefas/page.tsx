"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { DevTag } from "@/components/dev-tag";
import { VaultUnlockForm } from "@/components/vault-gate";
import { useVault } from "@/components/vault-provider";
import { Rail } from "@/components/tarefas/rail";
import { Sidebar } from "@/components/tarefas/sidebar";
import {
  CalendarIcon,
  CheckIcon,
  ChevronIcon,
  FlagIcon,
  MenuIcon,
  MoreIcon,
  PlusIcon,
  SortIcon,
  UndoIcon,
} from "@/components/todo-icons";
import { appendEvent, listDecryptedEvents } from "@/lib/events/event-store";
import { reduceLists } from "@/lib/events/lists-store";
import { reduceTodos } from "@/lib/events/todo-store";
import type { DecryptedEvent, ListItem, TodoItem, TodoPriority } from "@/lib/events/types";
import {
  PRIORITIES,
  SORT_MODE_LABELS,
  addDaysISO,
  applySortToSections,
  completedForView,
  dueColor,
  flatForView,
  formatDue,
  nextPriority,
  sectionsForView,
  todayISO,
  viewKey,
  viewTitle,
  type SortDirection,
  type SortMode,
  type TarefasView,
} from "@/lib/todos/view";

const SORT_DEFAULT_DIRECTION: Record<SortMode, SortDirection> = {
  prioridade: "desc",
  vencimento: "asc",
  criacao: "asc",
  titulo: "asc",
};

export default function TarefasPage() {
  return (
    <>
      <DevTag id="app/tarefas/page.tsx#TarefasPage" />
      <TarefasGate />
    </>
  );
}

function TarefasGate() {
  const { key } = useVault();

  if (!key) {
    return (
      <main className="flex flex-1 flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Tarefas</h1>
        <VaultUnlockForm />
      </main>
    );
  }

  return <TarefasApp />;
}

function TarefasApp() {
  const { key } = useVault();
  const [events, setEvents] = useState<DecryptedEvent[]>([]);
  const [view, setView] = useState<TarefasView>({ type: "hoje" });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const today = useMemo(() => todayISO(), []);

  // Em telas estreitas a barra lateral é um drawer: escolher uma view a fecha.
  function selectView(next: TarefasView) {
    setView(next);
    setSidebarOpen(false);
  }

  useEffect(() => {
    if (!key) return;
    listDecryptedEvents(key).then(setEvents);
  }, [key]);

  async function reload() {
    if (!key) return;
    setEvents(await listDecryptedEvents(key));
  }

  const todos = useMemo(() => reduceTodos(events), [events]);
  const lists = useMemo(() => reduceLists(events), [events]);

  async function createList(nome: string, cor: string) {
    if (!key) return;
    await appendEvent(key, { type: "list_created", listaId: crypto.randomUUID(), nome, cor });
    await reload();
  }

  async function renameList(listaId: string, nome: string) {
    if (!key) return;
    await appendEvent(key, { type: "list_renamed", listaId, nome });
    await reload();
  }

  async function recolorList(listaId: string, cor: string) {
    if (!key) return;
    await appendEvent(key, { type: "list_recolored", listaId, cor });
    await reload();
  }

  async function deleteList(listaId: string) {
    if (!key) return;
    // Reatribui as tarefas da lista para a Caixa de Entrada antes de apagar
    // a lista — evita órfãs com listaId apontando para uma lista inexistente.
    const affected = todos.filter((t) => t.listaId === listaId);
    for (const t of affected) {
      await appendEvent(key, { type: "todo_updated", todoId: t.id, listaId: null });
    }
    await appendEvent(key, { type: "list_deleted", listaId });
    if (view.type === "lista" && view.listaId === listaId) setView({ type: "inbox" });
    await reload();
  }

  async function createTodo(texto: string, prioridade: TodoPriority, vencimento: string | null) {
    if (!key) return;
    const listaId = view.type === "lista" ? view.listaId : null;
    await appendEvent(key, {
      type: "todo_created",
      todoId: crypto.randomUUID(),
      texto,
      prioridade,
      vencimento,
      listaId,
    });
    await reload();
  }

  async function toggle(todo: TodoItem) {
    if (!key) return;
    await appendEvent(key, { type: "todo_toggled", todoId: todo.id, concluido: !todo.concluido });
    await reload();
  }

  async function cyclePriority(todo: TodoItem) {
    if (!key) return;
    await appendEvent(key, {
      type: "todo_updated",
      todoId: todo.id,
      prioridade: nextPriority(todo.prioridade),
    });
    await reload();
  }

  async function reschedule(todo: TodoItem, value: string) {
    if (!key) return;
    await appendEvent(key, { type: "todo_updated", todoId: todo.id, vencimento: value || null });
    await reload();
  }

  async function softDelete(todo: TodoItem) {
    if (!key) return;
    await appendEvent(key, { type: "todo_deleted", todoId: todo.id });
    await reload();
  }

  async function restore(todo: TodoItem) {
    if (!key) return;
    await appendEvent(key, { type: "todo_restored", todoId: todo.id });
    await reload();
  }

  return (
    <div className="relative flex h-[calc(100dvh-56px)] flex-1 overflow-hidden">
      <Rail />

      {sidebarOpen && (
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
        />
      )}
      <div
        className={`fixed inset-y-0 left-0 z-30 md:static md:z-auto ${
          sidebarOpen ? "flex" : "hidden md:flex"
        }`}
      >
        <Sidebar
          todos={todos}
          lists={lists}
          today={today}
          selected={view}
          onSelect={selectView}
          onCreateList={createList}
          onRenameList={renameList}
          onRecolorList={recolorList}
          onDeleteList={deleteList}
        />
      </div>

      <MainPanel
        todos={todos}
        lists={lists}
        today={today}
        view={view}
        onOpenSidebar={() => setSidebarOpen(true)}
        onCreateTodo={createTodo}
        onToggle={toggle}
        onCyclePriority={cyclePriority}
        onReschedule={reschedule}
        onDelete={softDelete}
        onRestore={restore}
      />
    </div>
  );
}

function MainPanel({
  todos,
  lists,
  today,
  view,
  onOpenSidebar,
  onCreateTodo,
  onToggle,
  onCyclePriority,
  onReschedule,
  onDelete,
  onRestore,
}: {
  todos: TodoItem[];
  lists: ListItem[];
  today: string;
  view: TarefasView;
  onOpenSidebar: () => void;
  onCreateTodo: (texto: string, prioridade: TodoPriority, vencimento: string | null) => void;
  onToggle: (todo: TodoItem) => void;
  onCyclePriority: (todo: TodoItem) => void;
  onReschedule: (todo: TodoItem, value: string) => void;
  onDelete: (todo: TodoItem) => void;
  onRestore: (todo: TodoItem) => void;
}) {
  const isTrash = view.type === "lixeira";
  const isGlobalCompleted = view.type === "concluido";
  const canAdd = !isTrash && !isGlobalCompleted;

  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [sortState, setSortState] = useState<{ mode: SortMode; direction: SortDirection } | null>(
    null,
  );
  const sortMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sortMenuOpen) return;
    function handlePointerDown(e: PointerEvent) {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setSortMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [sortMenuOpen]);

  function chooseSort(mode: SortMode) {
    setSortState((prev) => {
      if (prev?.mode === mode) return { mode, direction: prev.direction === "asc" ? "desc" : "asc" };
      return { mode, direction: SORT_DEFAULT_DIRECTION[mode] };
    });
  }

  const rawSections = canAdd ? sectionsForView(todos, view, today) : [];
  const sections = sortState
    ? applySortToSections(rawSections, sortState.mode, sortState.direction)
    : rawSections;
  const completedInScope = canAdd ? completedForView(todos, view) : [];
  const flat = !canAdd ? flatForView(todos, view) : [];

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  function toggleSection(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const vazio = canAdd
    ? sections.length === 0 && completedInScope.length === 0
    : flat.length === 0;

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col gap-2 overflow-y-auto p-6">
      <header className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenSidebar}
            title="Abrir menu"
            className="rounded p-1.5 text-muted hover:bg-surface hover:text-foreground md:hidden"
          >
            <MenuIcon />
          </button>
          <h1 className="text-xl font-semibold tracking-tight">{viewTitle(view, lists)}</h1>
        </div>
        <div ref={sortMenuRef} className="relative flex items-center gap-1 text-muted">
          <button
            type="button"
            onClick={() => setSortMenuOpen((v) => !v)}
            title="Ordenar"
            className={`rounded p-1.5 hover:bg-surface hover:text-foreground ${
              sortState ? "text-accent" : ""
            }`}
          >
            <SortIcon />
          </button>
          <button type="button" title="Mais opções — em breve" className="cursor-default rounded p-1.5">
            <MoreIcon />
          </button>

          {sortMenuOpen && (
            <div className="absolute right-0 top-full z-10 mt-1 flex w-52 flex-col gap-0.5 rounded-lg bg-surface p-1.5 shadow-lg">
              {(Object.keys(SORT_MODE_LABELS) as SortMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => chooseSort(mode)}
                  className={`flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm ${
                    sortState?.mode === mode
                      ? "bg-background text-foreground"
                      : "text-foreground/90 hover:bg-background"
                  }`}
                >
                  {SORT_MODE_LABELS[mode]}
                  {sortState?.mode === mode && (
                    <span className="text-xs text-muted">
                      {sortState.direction === "asc" ? "↑" : "↓"}
                    </span>
                  )}
                </button>
              ))}
              {sortState && (
                <button
                  type="button"
                  onClick={() => {
                    setSortState(null);
                    setSortMenuOpen(false);
                  }}
                  className="mt-1 rounded-md px-2 py-1.5 text-left text-xs text-muted hover:bg-background hover:text-foreground"
                >
                  Padrão (por seção)
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {canAdd && <AddTaskBar key={viewKey(view)} view={view} onCreateTodo={onCreateTodo} />}

      {vazio && (
        <p className="px-2 py-8 text-center text-sm text-muted">
          {isTrash ? "A lixeira está vazia." : "Nenhuma tarefa por aqui."}
        </p>
      )}

      {canAdd &&
        sections.map((section) => (
          <Section
            key={section.key}
            nome={section.nome}
            count={section.itens.length}
            open={!collapsed.has(section.key)}
            onToggle={() => toggleSection(section.key)}
          >
            {section.itens.map((todo) => (
              <TaskRow
                key={todo.id}
                todo={todo}
                today={today}
                onToggle={() => onToggle(todo)}
                onCyclePriority={() => onCyclePriority(todo)}
                onReschedule={(v) => onReschedule(todo, v)}
                onDelete={() => onDelete(todo)}
              />
            ))}
          </Section>
        ))}

      {canAdd && completedInScope.length > 0 && (
        <Section
          nome="Concluído"
          count={completedInScope.length}
          open={!collapsed.has("concluido-escopo")}
          onToggle={() => toggleSection("concluido-escopo")}
        >
          {completedInScope.map((todo) => (
            <TaskRow
              key={todo.id}
              todo={todo}
              today={today}
              onToggle={() => onToggle(todo)}
              onCyclePriority={() => onCyclePriority(todo)}
              onReschedule={(v) => onReschedule(todo, v)}
              onDelete={() => onDelete(todo)}
            />
          ))}
        </Section>
      )}

      {isGlobalCompleted && (
        <ul className="flex flex-col">
          {flat.map((todo) => (
            <TaskRow
              key={todo.id}
              todo={todo}
              today={today}
              onToggle={() => onToggle(todo)}
              onCyclePriority={() => onCyclePriority(todo)}
              onReschedule={(v) => onReschedule(todo, v)}
              onDelete={() => onDelete(todo)}
            />
          ))}
        </ul>
      )}

      {isTrash && (
        <ul className="flex flex-col">
          {flat.map((todo) => (
            <TrashRow key={todo.id} todo={todo} onRestore={() => onRestore(todo)} />
          ))}
        </ul>
      )}
    </main>
  );
}

function AddTaskBar({
  view,
  onCreateTodo,
}: {
  view: TarefasView;
  onCreateTodo: (texto: string, prioridade: TodoPriority, vencimento: string | null) => void;
}) {
  // Cada view sugere uma data padrão coerente com o que ela representa
  // (Hoje -> hoje, Amanhã -> amanhã). O pai monta este componente com
  // key={viewKey(view)}, então trocar de view remonta e zera o rascunho —
  // sem precisar de um efeito para "resetar estado ao mudar de prop".
  const [texto, setTexto] = useState("");
  const [prioridade, setPrioridade] = useState<TodoPriority>(0);
  const [vencimento, setVencimento] = useState(() => {
    if (view.type === "hoje") return todayISO();
    if (view.type === "amanha") return addDaysISO(todayISO(), 1);
    return "";
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (texto.trim().length === 0) return;
    onCreateTodo(texto.trim(), prioridade, vencimento || null);
    setTexto("");
    setPrioridade(0);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-3 rounded-xl bg-surface px-3 py-2.5 ring-1 ring-transparent transition-shadow focus-within:ring-border"
    >
      <span className="text-muted">
        <PlusIcon />
      </span>
      <input
        type="text"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Adicionar tarefa"
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
      />
      <button
        type="button"
        onClick={() => setPrioridade(nextPriority(prioridade))}
        title={`Prioridade: ${PRIORITIES[prioridade].label}`}
        className="shrink-0 rounded p-0.5 hover:bg-background"
      >
        <FlagIcon color={PRIORITIES[prioridade].color} />
      </button>
      <label
        className="relative shrink-0 cursor-pointer rounded p-0.5 hover:bg-background"
        title="Definir data"
        style={{ color: vencimento ? "#6ea8fe" : "var(--color-muted)" }}
      >
        <CalendarIcon />
        <input
          type="date"
          value={vencimento}
          onChange={(e) => setVencimento(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0 [color-scheme:dark]"
        />
      </label>
      {texto.trim().length > 0 && (
        <button
          type="submit"
          className="shrink-0 rounded-lg bg-accent px-3 py-1 text-xs font-medium text-background"
        >
          Adicionar
        </button>
      )}
    </form>
  );
}

function Section({
  nome,
  count,
  open,
  onToggle,
  children,
}: {
  nome: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-2 px-2 py-2 text-muted hover:text-foreground"
      >
        <ChevronIcon open={open} />
        <span className="text-sm font-semibold text-foreground">{nome}</span>
        <span className="text-xs text-muted">{count}</span>
      </button>
      {open && <ul className="flex flex-col">{children}</ul>}
    </section>
  );
}

function TaskRow({
  todo,
  today,
  onToggle,
  onCyclePriority,
  onReschedule,
  onDelete,
}: {
  todo: TodoItem;
  today: string;
  onToggle: () => void;
  onCyclePriority: () => void;
  onReschedule: (value: string) => void;
  onDelete: () => void;
}) {
  const pr = PRIORITIES[todo.prioridade];
  const ringColor = todo.concluido ? "#58617a" : pr.color;

  return (
    <li className="group flex items-center gap-3 border-b border-border/50 px-2 py-2.5 hover:bg-background/60">
      <button
        type="button"
        onClick={onToggle}
        aria-label={todo.concluido ? "Reabrir tarefa" : "Concluir tarefa"}
        className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-2 transition-colors"
        style={{
          borderColor: ringColor,
          backgroundColor: todo.concluido ? "#58617a" : "transparent",
        }}
      >
        {todo.concluido ? (
          <CheckIcon />
        ) : (
          <span className="opacity-0 transition-opacity group-hover:opacity-100">
            <CheckIcon color={pr.color} />
          </span>
        )}
      </button>

      <span
        className={`flex-1 truncate text-sm ${
          todo.concluido ? "text-muted line-through" : "text-foreground"
        }`}
        title={todo.texto}
      >
        {todo.texto}
      </span>

      {todo.vencimento && (
        <label
          className="relative flex shrink-0 cursor-pointer items-center gap-1 text-xs"
          style={{ color: todo.concluido ? "var(--color-muted)" : dueColor(todo.vencimento, today) }}
          title="Reagendar"
        >
          <CalendarIcon small />
          <span>{formatDue(todo.vencimento, today)}</span>
          <input
            type="date"
            value={todo.vencimento}
            onChange={(e) => onReschedule(e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0 [color-scheme:dark]"
          />
        </label>
      )}

      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100">
        {!todo.vencimento && (
          <label
            className="relative cursor-pointer rounded p-0.5 text-muted hover:text-foreground"
            title="Adicionar data"
          >
            <CalendarIcon small />
            <input
              type="date"
              value=""
              onChange={(e) => onReschedule(e.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0 [color-scheme:dark]"
            />
          </label>
        )}
        <button
          type="button"
          onClick={onCyclePriority}
          title={`Prioridade: ${pr.label}`}
          className="rounded p-0.5 hover:bg-background"
        >
          <FlagIcon color={pr.color} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          title="Excluir"
          className="rounded px-1 text-muted hover:text-red-400"
        >
          ✕
        </button>
      </div>
    </li>
  );
}

function TrashRow({ todo, onRestore }: { todo: TodoItem; onRestore: () => void }) {
  return (
    <li className="group flex items-center gap-3 border-b border-border/50 px-2 py-2.5">
      <span className="flex-1 truncate text-sm text-muted line-through" title={todo.texto}>
        {todo.texto}
      </span>
      <button
        type="button"
        onClick={onRestore}
        className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-accent hover:bg-background"
      >
        <UndoIcon />
        Restaurar
      </button>
    </li>
  );
}
