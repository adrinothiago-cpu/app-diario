"use client";

import { useState, type FormEvent } from "react";
import {
  CheckCircleIcon,
  CheckIcon,
  InboxIcon,
  LayersIcon,
  MoreIcon,
  PlusIcon,
  SunIcon,
  SunriseIcon,
  TrashIcon,
} from "@/components/todo-icons";
import type { ListItem, TodoItem } from "@/lib/events/types";
import { countForView, viewKey, type TarefasView } from "@/lib/todos/view";
import { MiniCalendar } from "./mini-calendar";

const LIST_COLORS = ["#f87171", "#fbbf24", "#22c55e", "#6ea8fe", "#a78bfa", "#f472b6"];

export function Sidebar({
  todos,
  lists,
  today,
  selected,
  onSelect,
  onCreateList,
  onRenameList,
  onRecolorList,
  onDeleteList,
}: {
  todos: TodoItem[];
  lists: ListItem[];
  today: string;
  selected: TarefasView;
  onSelect: (view: TarefasView) => void;
  onCreateList: (nome: string, cor: string) => void;
  onRenameList: (listaId: string, nome: string) => void;
  onRecolorList: (listaId: string, cor: string) => void;
  onDeleteList: (listaId: string) => void;
}) {
  const [addingList, setAddingList] = useState(false);
  const [nomeLista, setNomeLista] = useState("");
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);

  function submitList(e: FormEvent) {
    e.preventDefault();
    const nome = nomeLista.trim();
    if (nome.length === 0) return;
    const cor = LIST_COLORS[lists.length % LIST_COLORS.length];
    onCreateList(nome, cor);
    setNomeLista("");
    setAddingList(false);
  }

  const isActive = (view: TarefasView) => viewKey(view) === viewKey(selected);

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col overflow-y-auto bg-surface">
      <div className="flex flex-col gap-0.5 px-2 pt-3">
        <NavItem
          icon={<SunIcon />}
          label="Hoje"
          count={countForView(todos, { type: "hoje" }, today)}
          active={isActive({ type: "hoje" })}
          onClick={() => onSelect({ type: "hoje" })}
        />
        <NavItem
          icon={<SunriseIcon />}
          label="Amanhã"
          count={countForView(todos, { type: "amanha" }, today)}
          active={isActive({ type: "amanha" })}
          onClick={() => onSelect({ type: "amanha" })}
        />
        <NavItem
          icon={<LayersIcon />}
          label="Próximos 7 dias"
          count={countForView(todos, { type: "proximos7" }, today)}
          active={isActive({ type: "proximos7" })}
          onClick={() => onSelect({ type: "proximos7" })}
        />
        <NavItem
          icon={<InboxIcon />}
          label="Caixa de Entrada"
          count={countForView(todos, { type: "inbox" }, today)}
          active={isActive({ type: "inbox" })}
          onClick={() => onSelect({ type: "inbox" })}
        />
      </div>

      <SectionLabel>Listas</SectionLabel>
      <div className="flex flex-col gap-0.5 px-2">
        {lists.map((list) => (
          <ListNavItem
            key={list.id}
            list={list}
            count={countForView(todos, { type: "lista", listaId: list.id }, today)}
            active={isActive({ type: "lista", listaId: list.id })}
            menuOpen={openMenuFor === list.id}
            onClick={() => onSelect({ type: "lista", listaId: list.id })}
            onToggleMenu={() => setOpenMenuFor(openMenuFor === list.id ? null : list.id)}
            onRename={(nome) => {
              onRenameList(list.id, nome);
              setOpenMenuFor(null);
            }}
            onRecolor={(cor) => onRecolorList(list.id, cor)}
            onDelete={() => {
              onDeleteList(list.id);
              setOpenMenuFor(null);
            }}
          />
        ))}

        {addingList ? (
          <form onSubmit={submitList} className="flex items-center gap-2 px-2 py-1.5">
            <input
              autoFocus
              value={nomeLista}
              onChange={(e) => setNomeLista(e.target.value)}
              onBlur={() => {
                if (nomeLista.trim().length === 0) setAddingList(false);
              }}
              placeholder="Nome da lista"
              className="w-full rounded-md bg-background px-2 py-1 text-sm text-foreground outline-none"
            />
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAddingList(true)}
            className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-muted hover:bg-background hover:text-foreground"
          >
            <PlusIcon />
            Nova lista
          </button>
        )}
      </div>

      <SectionLabel>Filtros</SectionLabel>
      <p className="px-4 pb-2 text-xs leading-snug text-muted">
        Mostrar tarefas filtradas por lista, data, prioridade, etiqueta e mais.
      </p>

      <div className="mt-2 flex flex-col gap-0.5 px-2 pb-2">
        <NavItem
          icon={<CheckCircleIcon />}
          label="Concluído"
          count={countForView(todos, { type: "concluido" }, today)}
          active={isActive({ type: "concluido" })}
          onClick={() => onSelect({ type: "concluido" })}
        />
        <NavItem
          icon={<TrashIcon />}
          label="Lixeira"
          count={countForView(todos, { type: "lixeira" }, today)}
          active={isActive({ type: "lixeira" })}
          onClick={() => onSelect({ type: "lixeira" })}
        />
      </div>

      <div className="mt-auto border-t border-border/50">
        <MiniCalendar todos={todos} today={today} />
      </div>
    </aside>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-4 pb-1 pt-4 text-xs font-medium uppercase tracking-wide text-muted/70">
      {children}
    </span>
  );
}

function NavItem({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
        active ? "bg-background text-foreground" : "text-foreground/90 hover:bg-background"
      }`}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {count > 0 && <span className="text-xs text-muted">{count}</span>}
    </button>
  );
}

function ListNavItem({
  list,
  count,
  active,
  menuOpen,
  onClick,
  onToggleMenu,
  onRename,
  onRecolor,
  onDelete,
}: {
  list: ListItem;
  count: number;
  active: boolean;
  menuOpen: boolean;
  onClick: () => void;
  onToggleMenu: () => void;
  onRename: (nome: string) => void;
  onRecolor: (cor: string) => void;
  onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [nome, setNome] = useState(list.nome);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function startRename() {
    setNome(list.nome);
    setRenaming(true);
  }

  function submitRename(e: FormEvent) {
    e.preventDefault();
    const trimmed = nome.trim();
    if (trimmed.length > 0) onRename(trimmed);
    setRenaming(false);
  }

  return (
    <div className={`rounded-lg ${menuOpen ? "bg-background" : ""}`}>
      <div
        className={`group flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors ${
          active ? "bg-background text-foreground" : "text-foreground/90 hover:bg-background"
        }`}
      >
        <button type="button" onClick={onClick} className="flex flex-1 items-center gap-2.5 text-left">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: list.cor }} />
          <span className="flex-1 truncate">{list.nome}</span>
        </button>
        {count > 0 && !menuOpen && <span className="text-xs text-muted">{count}</span>}
        <button
          type="button"
          onClick={onToggleMenu}
          title="Mais opções da lista"
          className={`shrink-0 rounded p-0.5 text-muted hover:text-foreground ${
            menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
          }`}
        >
          <MoreIcon />
        </button>
      </div>

      {menuOpen && (
        <div className="flex flex-col gap-2 px-3 pb-3 pt-1">
          {renaming ? (
            <form onSubmit={submitRename} className="flex items-center gap-1.5">
              <input
                autoFocus
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className="w-full rounded-md bg-surface px-2 py-1 text-sm text-foreground outline-none"
              />
              <button type="submit" className="shrink-0 rounded p-1 text-accent">
                <CheckIcon color="#6ea8fe" />
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={startRename}
              className="rounded-md px-2 py-1 text-left text-xs text-foreground/90 hover:bg-surface"
            >
              Renomear
            </button>
          )}

          <div className="flex items-center gap-1.5 px-2">
            {LIST_COLORS.map((cor) => (
              <button
                key={cor}
                type="button"
                onClick={() => onRecolor(cor)}
                title={cor}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: cor }}
              >
                {list.cor === cor && <CheckIcon color="#0b0e14" />}
              </button>
            ))}
          </div>

          {confirmingDelete ? (
            <div className="flex flex-col gap-1.5 rounded-md bg-surface px-2 py-2">
              <span className="text-xs text-muted">
                Excluir &quot;{list.nome}&quot;? As tarefas voltam para a Caixa de Entrada.
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onDelete}
                  className="rounded px-2 py-1 text-xs font-medium text-red-400 hover:bg-background"
                >
                  Excluir
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="rounded px-2 py-1 text-xs text-muted hover:bg-background"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="rounded-md px-2 py-1 text-left text-xs text-red-400 hover:bg-surface"
            >
              Excluir lista
            </button>
          )}
        </div>
      )}
    </div>
  );
}
