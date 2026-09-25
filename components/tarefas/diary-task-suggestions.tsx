"use client";

/**
 * Botão + modal que lê entradas recentes do Diário e pede à Gemini API para
 * sugerir tarefas acionáveis. Nada é enviado até o usuário confirmar
 * explicitamente dentro do modal ("Gerar sugestões agora") — abrir o modal
 * sozinho não dispara nenhuma chamada de rede. Nenhuma sugestão vira tarefa
 * sem o usuário marcar e clicar em "Adicionar selecionadas".
 */
import Link from "next/link";
import { useState } from "react";
import { FlagIcon, SparkleIcon } from "@/components/todo-icons";
import type { DiaryEntryItem, TodoPriority } from "@/lib/events/types";
import {
  generateTaskSuggestions,
  MAX_ENTRIES_FOR_TASK_SUGGESTIONS,
  type TaskSuggestion,
} from "@/lib/insights/gemini-task-suggestions";
import { PRIORITIES, todayISO } from "@/lib/todos/view";

export interface DiaryTaskSuggestionsProps {
  geminiApiKey: string | null;
  diaryEntries: DiaryEntryItem[];
  existingOpenTodos: string[];
  onAccept: (texto: string, prioridade: TodoPriority, vencimento: string | null) => Promise<void>;
}

type Status = "idle" | "loading" | "done" | "error";

export function DiaryTaskSuggestions({
  geminiApiKey,
  diaryEntries,
  existingOpenTodos,
  onAccept,
}: DiaryTaskSuggestionsProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<TaskSuggestion[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());

  function openModal() {
    setOpen(true);
    setStatus("idle");
    setError(null);
    setSuggestions([]);
  }

  function closeModal() {
    setOpen(false);
  }

  async function handleGenerate() {
    if (!geminiApiKey) {
      setStatus("error");
      setError("Configure a chave da Gemini API no Diário primeiro.");
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const result = await generateTaskSuggestions(geminiApiKey, diaryEntries, existingOpenTodos, todayISO());
      setSuggestions(result);
      setChecked(new Set(result.map((_, i) => i)));
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao gerar sugestões.");
      setStatus("error");
    }
  }

  function toggle(i: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  // Sequencial de propósito: `onAccept` grava um evento e relê todo o log do
  // IndexedDB (appendEvent + reload). Disparar tudo em paralelo (Promise.all
  // ou forEach sem await) faz os reloads concorrentes competirem entre si —
  // o último a resolver "vence" e pode sobrescrever o estado do React com um
  // snapshot anterior, sem as tarefas recém-criadas (mesmo já persistidas no
  // banco). Aguardar uma de cada vez elimina a corrida.
  async function handleAddSelected() {
    for (const [i, s] of suggestions.entries()) {
      if (checked.has(i)) {
        await onAccept(s.texto, s.prioridade, s.vencimento);
      }
    }
    closeModal();
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        title="Sugerir tarefas com IA a partir do Diário"
        className="rounded p-1.5 text-muted hover:bg-surface hover:text-foreground"
      >
        <SparkleIcon />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="flex max-h-[80vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-xl bg-surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Sugestões de tarefas com IA</h2>
              <button type="button" onClick={closeModal} className="text-muted hover:text-foreground">
                ✕
              </button>
            </div>

            {status === "idle" && (
              <>
                <p className="text-sm text-muted">
                  Ao gerar, o texto (escrito e/ou transcrito) de até {MAX_ENTRIES_FOR_TASK_SUGGESTIONS}{" "}
                  entradas recentes do diário é enviado à Gemini API — mesma chave configurada em
                  Configurar transcrição, no Diário — para identificar pendências e sugerir tarefas.
                  Nada é criado automaticamente: você revisa e escolhe o que aceitar a seguir.
                </p>
                <button
                  type="button"
                  onClick={handleGenerate}
                  className="w-fit rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-background"
                >
                  Gerar sugestões agora
                </button>
              </>
            )}

            {status === "loading" && <p className="text-sm text-muted">Lendo o diário e gerando sugestões…</p>}

            {status === "error" && (
              <p className="text-sm text-red-400">
                {error}
                {!geminiApiKey && (
                  <>
                    {" "}
                    <Link href="/diario" className="underline">
                      Configurar no Diário
                    </Link>
                  </>
                )}
              </p>
            )}

            {status === "done" && suggestions.length === 0 && (
              <p className="text-sm text-muted">Nenhuma pendência clara encontrada nas entradas recentes.</p>
            )}

            {status === "done" && suggestions.length > 0 && (
              <>
                <ul className="flex flex-col gap-2">
                  {suggestions.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 rounded-lg bg-background p-2.5">
                      <input
                        type="checkbox"
                        checked={checked.has(i)}
                        onChange={() => toggle(i)}
                        className="mt-1"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <FlagIcon color={PRIORITIES[s.prioridade].color} />
                          <span className="text-sm text-foreground">{s.texto}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted">
                          {s.vencimento && <>Vencimento: {s.vencimento} · </>}
                          {s.motivo}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-lg border border-border px-3 py-1.5 text-sm"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleAddSelected()}
                    disabled={checked.size === 0}
                    className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
                  >
                    Adicionar selecionadas ({checked.size})
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
