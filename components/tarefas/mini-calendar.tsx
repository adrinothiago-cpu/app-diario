"use client";

/**
 * Tira de semana no rodapé da barra lateral, como no TickTick: letra do dia
 * da semana, número do dia (hoje destacado) e um ponto sob dias com tarefas
 * pendentes. Só leitura nesta etapa — clicar num dia para filtrar fica para
 * uma etapa futura (documentado no handoff), não simulamos essa interação.
 */
import { addDaysISO } from "@/lib/todos/view";
import type { TodoItem } from "@/lib/events/types";

const DIAS = ["D", "S", "T", "Q", "Q", "S", "S"];

export function MiniCalendar({ todos, today }: { todos: TodoItem[]; today: string }) {
  const [y, m, d] = today.split("-").map(Number);
  const weekday = new Date(y, m - 1, d).getDay();
  const weekStart = addDaysISO(today, -weekday);
  const week = Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i));

  const datasComPendencia = new Set(
    todos.filter((t) => !t.concluido && t.apagadoEm === null && t.vencimento).map((t) => t.vencimento),
  );

  return (
    <div className="grid grid-cols-7 gap-1 px-3 py-3 text-center">
      {DIAS.map((label, i) => (
        <span key={i} className="text-[11px] text-muted">
          {label}
        </span>
      ))}
      {week.map((iso) => {
        const dayNum = Number(iso.slice(-2));
        const isToday = iso === today;
        return (
          <div key={iso} className="flex flex-col items-center gap-0.5">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                isToday ? "bg-accent font-semibold text-background" : "text-foreground"
              }`}
            >
              {dayNum}
            </span>
            <span
              className={`h-1 w-1 rounded-full ${
                datasComPendencia.has(iso) ? "bg-accent" : "bg-transparent"
              }`}
            />
          </div>
        );
      })}
    </div>
  );
}
