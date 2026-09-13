/**
 * Geração de insights de humor a partir das entradas de diário usando a Gemini API.
 * Usa o cliente HTTP comum `callGeminiInteraction` e valida a resposta em JSON estrito.
 */
import { callGeminiInteraction } from "@/lib/gemini/client";
import type { DiaryEntryItem, MoodInsights, MoodTrend } from "@/lib/events/types";

export const MAX_ENTRIES_FOR_INSIGHTS = 30;

export class InsightsError extends Error {}

const VALID_TRENDS: readonly MoodTrend[] = [
  "melhorando",
  "piorando",
  "estavel",
  "sem_dados_suficientes",
] as const;

/**
 * Seleciona as entradas elegíveis (com conteúdo escrito ou transcrição de voz),
 * respeitando o limite máximo e mantendo a ordem mais-recente-primeiro.
 */
export function selectEntriesForInsights(
  entries: DiaryEntryItem[],
  limit = MAX_ENTRIES_FOR_INSIGHTS,
): DiaryEntryItem[] {
  return entries
    .filter((e) => e.conteudo.trim() !== "" || (e.transcricao !== null && e.transcricao.trim() !== ""))
    .slice(0, limit);
}

/**
 * Monta o prompt para o modelo: inclui o resumo anterior (se houver) para
 * pedir refinamento/evolução e a lista de entradas recentes. Pede JSON estrito.
 */
export function buildInsightsPrompt(
  entries: DiaryEntryItem[],
  previousInsights: MoodInsights | null,
): string {
  const formattedEntries = entries
    .map((e, idx) => {
      const parts: string[] = [];
      parts.push(`[Entrada ${idx + 1}] Horário: ${e.horario} | Humor: ${e.humor}/5`);
      if (e.conteudo.trim() !== "") {
        parts.push(`Texto: ${e.conteudo.trim()}`);
      }
      if (e.transcricao && e.transcricao.trim() !== "") {
        parts.push(`Transcrição do áudio: ${e.transcricao.trim()}`);
      }
      return parts.join("\n");
    })
    .join("\n\n");

  const contextSection = previousInsights
    ? `Aqui está o resumo da análise anterior:
${JSON.stringify(
  {
    resumoGeral: previousInsights.resumoGeral,
    gatilhosPositivos: previousInsights.gatilhosPositivos,
    gatilhosNegativos: previousInsights.gatilhosNegativos,
    sugestoesMelhoria: previousInsights.sugestoesMelhoria,
    tendencia: previousInsights.tendencia,
  },
  null,
  2,
)}

Atualize o resumo considerando as novas entradas fornecidas abaixo — refine ou substitua itens que não são mais relevantes, mantenha cada lista com no máximo 5 itens curtos e acionáveis, e indique a tendência comparando com o resumo anterior ("melhorando", "piorando" ou "estavel"). Não acumule itens infinitamente: mantenha o resumo conciso e atualizado.`
    : `Esta é a primeira análise das entradas de diário. Identifique padrões emocionais, gatilhos associados a humor positivo e negativo, e sugestões práticas de melhoria. Mantenha cada lista com no máximo 5 itens curtos e acionáveis. Como não há análise anterior para comparação, o campo "tendencia" DEVE ser "sem_dados_suficientes".`;

  return `Você é um assistente empático de reflexão pessoal e análise de bem-estar emocional. Analise as seguintes entradas do diário do usuário:

${contextSection}

Entradas a analisar (mais recentes primeiro):
${formattedEntries}

Responda OBRIGATORIAMENTE em JSON estrito (sem markdown, sem cercas de código, sem texto antes ou depois) no seguinte formato:
{
  "resumoGeral": "um parágrafo conciso sobre o padrão emocional observado",
  "gatilhosPositivos": ["item 1", "item 2", ...],
  "gatilhosNegativos": ["item 1", "item 2", ...],
  "sugestoesMelhoria": ["item 1", "item 2", ...],
  "tendencia": "melhorando" | "piorando" | "estavel" | "sem_dados_suficientes"
}`;
}

/**
 * Faz o parsing estrito da resposta JSON da LLM.
 * Remove cercas ```json ... ``` se o modelo tiver incluído, mas exige validação total do shape.
 */
export function parseInsightsResponse(raw: string, baseadoEmEntradas = 0): MoodInsights {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new InsightsError(
      `Resposta não é um JSON válido. Conteúdo recebido: ${raw.slice(0, 300)}`,
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new InsightsError(`Resposta JSON não é um objeto. Conteúdo: ${raw.slice(0, 300)}`);
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.resumoGeral !== "string" || obj.resumoGeral.trim().length === 0) {
    throw new InsightsError(`Campo 'resumoGeral' ausente ou inválido no JSON: ${raw.slice(0, 300)}`);
  }

  const validateStringArray = (field: string): string[] => {
    const val = obj[field];
    if (!Array.isArray(val) || !val.every((item) => typeof item === "string")) {
      throw new InsightsError(`Campo '${field}' deve ser um array de strings no JSON: ${raw.slice(0, 300)}`);
    }
    return val.map((s) => s.trim()).filter(Boolean);
  };

  const gatilhosPositivos = validateStringArray("gatilhosPositivos");
  const gatilhosNegativos = validateStringArray("gatilhosNegativos");
  const sugestoesMelhoria = validateStringArray("sugestoesMelhoria");

  const tendencia = obj.tendencia as MoodTrend;
  if (!VALID_TRENDS.includes(tendencia)) {
    throw new InsightsError(
      `Campo 'tendencia' inválido ('${String(obj.tendencia)}'). Valores permitidos: ${VALID_TRENDS.join(", ")}`,
    );
  }

  return {
    resumoGeral: obj.resumoGeral.trim(),
    gatilhosPositivos,
    gatilhosNegativos,
    sugestoesMelhoria,
    tendencia,
    baseadoEmEntradas,
  };
}

/**
 * Orquestra a geração de insights via Gemini API:
 * filtra entradas -> constrói prompt -> chama Gemini -> valida JSON.
 */
export async function generateMoodInsights(
  apiKey: string,
  entries: DiaryEntryItem[],
  previousInsights: MoodInsights | null,
): Promise<MoodInsights> {
  const selected = selectEntriesForInsights(entries, MAX_ENTRIES_FOR_INSIGHTS);
  if (selected.length === 0) {
    throw new InsightsError("Nenhuma entrada de diário com texto ou transcrição para analisar.");
  }

  const prompt = buildInsightsPrompt(selected, previousInsights);
  const rawResponse = await callGeminiInteraction(apiKey, [{ type: "text", text: prompt }]);
  return parseInsightsResponse(rawResponse, selected.length);
}
