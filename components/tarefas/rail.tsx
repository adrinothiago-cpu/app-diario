"use client";

/**
 * Barra de ícones mais à esquerda, no estilo TickTick (tasks/calendário/
 * pomodoro/hábitos/busca). Só o ícone de tarefas é funcional hoje — os
 * demais representam módulos que ainda não existem no app (Métricas/
 * Calendário na home) e ficam desabilitados com dica "Em breve", em vez de
 * simular uma função que não faz nada ao clicar.
 */
import { HabitIcon, InboxIcon, PomodoroIcon, SearchIcon } from "@/components/todo-icons";

export function Rail() {
  return (
    <nav className="hidden h-full w-11 shrink-0 flex-col items-center gap-1 bg-surface py-3 md:flex">
      <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-full bg-accent text-xs font-semibold text-background">
        {"D"}
      </div>

      <RailButton active title="Tarefas">
        <InboxIcon />
      </RailButton>
      <RailButton title="Calendário — em breve">
        <PomodoroIcon />
      </RailButton>
      <RailButton title="Hábitos — em breve">
        <HabitIcon />
      </RailButton>

      <div className="flex-1" />

      <RailButton title="Buscar — em breve">
        <SearchIcon />
      </RailButton>
    </nav>
  );
}

function RailButton({
  children,
  active,
  title,
}: {
  children: React.ReactNode;
  active?: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      disabled={!active}
      title={title}
      className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
        active ? "bg-background text-accent" : "cursor-default text-muted/50"
      }`}
    >
      {children}
    </button>
  );
}
