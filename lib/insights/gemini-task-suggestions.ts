/**
 * Sugestão de tarefas a partir das entradas de diário usando a Gemini API.
 * Mesmo cliente HTTP comum de `gemini-insights.ts`, mas em vez de um resumo
 * evolutivo de humor, extrai pendências/compromissos mencionados no diário
 * como tarefas acionáveis — nunca persistidas automaticamente, o usuário
 * revisa e escolhe quais aceitar (ver `components/tarefas/diary-task-suggestions.tsx`).
 */
import { callGeminiInteraction } from "@/lib/gemini/client";
import type { DiaryEntryItem, TodoPriority } from "@/lib/events/types";

export const MAX_ENTRIES_FOR_TASK_SUGGESTIONS = 15;
const MAX_SUGGESTIONS = 8;
const VALID_PRIORITIES: readonly TodoPriority[] = [0, 1, 2, 3] as const;

export class TaskSuggestionError extends Error {}

export interface TaskSuggestion {
  texto: string;
  prioridade: TodoPriority;
  vencimento: string | null;
  /** Explicação curta de por que a IA sugeriu esta tarefa — dá contexto para o usuário decidir. */
  motivo: string;
}

/** Mesma regra de elegibilidade dos insights: precisa de texto escrito ou transcrição de voz. */
export function selectEntriesForTaskSuggestions(
  entries: DiaryEntryItem[],
  limit = MAX_ENTRIES_FOR_TASK_SUGGESTIONS,
): DiaryEntryItem[] {
  return entries
    .filter((e) => e.conteudo.trim() !== "" || (e.transcricao !== null && e.transcricao.trim() !== ""))
    .slice(0, limit);
}

export function buildTaskSuggestionsPrompt(
  entries: DiaryEntryItem[],
  existingOpenTodos: string[],
  today: string,
): string {
  const formattedEntries = entries
    .map((e, idx) => {
      const parts: string[] = [`[Entrada ${idx + 1}] Horário: ${e.horario}`];
      if (e.conteudo.trim() !== "") parts.push(`Texto: ${e.conteudo.trim()}`);
      if (e.transcricao && e.transcricao.trim() !== "") {
        parts.push(`Transcrição do áudio: ${e.transcricao.trim()}`);
      }
      return parts.join("\n");
    })
    .join("\n\n");

  const existingSection =
    existingOpenTodos.length > 0
      ? `Tarefas já cadastradas e ainda ativas (NÃO sugira nada equivalente a estas):\n${existingOpenTodos
          .map((t) => `- ${t}`)
          .join("\n")}`
      : "Não há tarefas ativas cadastradas ainda.";

  return `Você é um assistente que identifica pendências e compromissos reais mencionados num diário pessoal, para virarem tarefas acionáveis numa lista de afazeres.

REGRAS:
1. Sugira só o que for uma AÇÃO CONCRETA que a pessoa mencionou precisar fazer, resolver, comprar, marcar, responder, entregar ou lembrar — não sugira hábitos genéricos de bem-estar (isso é coberto por outra análise, não repita esse tipo de sugestão aqui).
2. Resolva datas relativas ("amanhã", "sexta-feira", "semana que vem") para uma data absoluta ISO (AAAA-MM-DD), usando ${today} como hoje. Se não houver prazo mencionado, "vencimento" é null.
3. Priorize (0 nenhuma, 1 baixa, 2 média, 3 alta) pelo tom de urgência/estresse com que foi mencionado.
4. NÃO repita nada equivalente às tarefas já cadastradas listadas abaixo.
5. No máximo ${MAX_SUGGESTIONS} sugestões, sem duplicar entre si.
6. Cada sugestão tem um "motivo" curto (uma frase) citando o que no diário originou aquela tarefa.
7. Se não houver nenhuma pendência acionável clara, responda com uma lista vazia — não invente tarefas.

${existingSection}

Entradas do diário a analisar (mais recentes primeiro):
${formattedEntries}

Responda OBRIGATORIAMENTE em JSON estrito (sem markdown, sem cercas de código, sem texto antes ou depois) no seguinte formato:
{
  "sugestoes": [
    { "texto": "...", "prioridade": 0, "vencimento": "AAAA-MM-DD" | null, "motivo": "..." }
  ]
}`;
}

export function parseTaskSuggestionsResponse(raw: string): TaskSuggestion[] {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new TaskSuggestionError(
      `Resposta não é um JSON válido. Conteúdo recebido: ${raw.slice(0, 300)}`,
    );
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as Record<string, unknown>).sugestoes)) {
    throw new TaskSuggestionError(`Campo 'sugestoes' ausente ou inválido no JSON: ${raw.slice(0, 300)}`);
  }

  const sugestoes = (parsed as { sugestoes: unknown[] }).sugestoes;

  return sugestoes.map((item, idx) => {
    if (!item || typeof item !== "object") {
      throw new TaskSuggestionError(`Sugestão #${idx} não é um objeto: ${raw.slice(0, 300)}`);
    }
    const obj = item as Record<string, unknown>;

    if (typeof obj.texto !== "string" || obj.texto.trim() === "") {
      throw new TaskSuggestionError(`Sugestão #${idx} sem 'texto' válido: ${raw.slice(0, 300)}`);
    }
    if (!VALID_PRIORITIES.includes(obj.prioridade as TodoPriority)) {
      throw new TaskSuggestionError(`Sugestão #${idx} com 'prioridade' inválida: ${raw.slice(0, 300)}`);
    }
    if (obj.vencimento !== null && typeof obj.vencimento !== "string") {
      throw new TaskSuggestionError(`Sugestão #${idx} com 'vencimento' inválido: ${raw.slice(0, 300)}`);
    }
    if (typeof obj.motivo !== "string") {
      throw new TaskSuggestionError(`Sugestão #${idx} sem 'motivo' válido: ${raw.slice(0, 300)}`);
    }

    return {
      texto: obj.texto.trim(),
      prioridade: obj.prioridade as TodoPriority,
      vencimento: (obj.vencimento as string | null) ?? null,
      motivo: obj.motivo.trim(),
    };
  });
}

/** Orquestra: filtra entradas -> constrói prompt -> chama Gemini -> valida JSON. */
export async function generateTaskSuggestions(
  apiKey: string,
  entries: DiaryEntryItem[],
  existingOpenTodos: string[],
  today: string,
): Promise<TaskSuggestion[]> {
  const selected = selectEntriesForTaskSuggestions(entries, MAX_ENTRIES_FOR_TASK_SUGGESTIONS);
  if (selected.length === 0) {
    throw new TaskSuggestionError("Nenhuma entrada de diário com texto ou transcrição para analisar.");
  }

  const prompt = buildTaskSuggestionsPrompt(selected, existingOpenTodos, today);
  const result = await callGeminiInteraction(apiKey, [{ type: "text", text: prompt }]);
  return parseTaskSuggestionsResponse(result.text);
}
