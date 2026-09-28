/**
 * Cliente HTTP genérico para a Gemini "Interactions API"
 * (`generativelanguage.googleapis.com/v1beta/interactions`) — sem nada
 * específico de transcrição ou de insights, só a chamada e a extração do
 * texto de saída. Usado por `lib/transcription/gemini.ts` (áudio → texto)
 * e `lib/insights/gemini-insights.ts` (texto → texto).
 *
 * Modelos: usa `gemini-2.5-flash` como padrão por estabilidade e alta capacidade
 * no tier gratuito, com fallback automático para `gemini-flash-latest` e
 * `gemini-3.8-flash` se houver pico de demanda temporária nos servidores do Google.
 */
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
export const CANDIDATE_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.1-pro-preview",
  "gemini-3.1-flash-lite",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-flash-latest",
  "gemini-2.5-flash-lite",
] as const;

export type CandidateModel = (typeof CANDIDATE_MODELS)[number];

export interface GeminiInteractionResult {
  text: string;
  modelUsed: string;
}

export type InteractionInputBlock =
  | { type: "text"; text: string }
  | { type: "audio"; data: string; mime_type: string };

/** Ferramenta de busca do Google — grounding com resultados reais da web (ver `lib/insights/gemini-price-search.ts`). */
export type InteractionTool = { type: "google_search" };

interface ContentBlock {
  type?: string;
  text?: string;
}

interface InteractionStep {
  type?: string;
  content?: ContentBlock[];
}

interface InteractionResponse {
  output_text?: string;
  steps?: InteractionStep[];
}

export class GeminiCallError extends Error {}

/** Chave de API explicitamente inválida — erro fatal, nunca adianta tentar outro modelo candidato. */
export class GeminiInvalidKeyError extends GeminiCallError {}

export function parseErrorMessage(status: number, rawBody: string): string {
  try {
    const parsed = JSON.parse(rawBody);
    // A Interactions API às vezes embrulha o erro num array: [{ "error": {...} }].
    const errorObj = Array.isArray(parsed) ? parsed[0]?.error : parsed?.error;
    const msg = errorObj?.message;
    if (typeof msg === "string") {
      if (msg.includes("high demand") || msg.includes("spikes in demand")) {
        return "O modelo Gemini está com alta demanda temporária nos servidores do Google. Tente novamente em instantes.";
      }
      return msg;
    }
  } catch {
    // corpo não é JSON válido
  }
  return `Gemini API respondeu ${status}: ${rawBody.slice(0, 300)}`;
}

export async function callGeminiInteraction(
  apiKey: string,
  input: InteractionInputBlock[],
  options: { tools?: InteractionTool[] } = {},
): Promise<GeminiInteractionResult> {
  let lastError: Error | null = null;

  for (let i = 0; i < CANDIDATE_MODELS.length; i++) {
    const model = CANDIDATE_MODELS[i];
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input,
          ...(options.tools ? { tools: options.tools } : {}),
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const errorMsg = parseErrorMessage(response.status, body);

        // Erro fatal de credencial: chave explicitamente inválida falha imediatamente.
        // A Gemini API responde 400 (não 401/403) pra chave inválida — confirmado em
        // produção: {"error":{"code":400,"status":"INVALID_ARGUMENT",
        // "details":[{"reason":"API_KEY_INVALID", ...}]}}. Checa só o corpo (strings
        // específicas o bastante) pra não depender de um status que a API não usa.
        const isAuthInvalidKey =
          body.includes("API_KEY_INVALID") ||
          body.includes("API key not valid") ||
          body.toLowerCase().includes("invalid api key");

        if (isAuthInvalidKey) {
          throw new GeminiInvalidKeyError(
            "Chave da Gemini API inválida. Troque a chave em Diário → Configurar transcrição (Gemini API).",
          );
        }

        // Se houver mais modelos na lista, tenta o próximo
        if (i < CANDIDATE_MODELS.length - 1) {
          lastError = new GeminiCallError(errorMsg);
          continue;
        }

        throw new GeminiCallError(
          `Todos os modelos Gemini testados falharam. Último erro (${model}): ${errorMsg}`,
        );
      }

      const data: InteractionResponse = await response.json();
      const text = extractOutputText(data);
      if (text === null) {
        throw new GeminiCallError(
          `Não consegui extrair o texto da resposta da API (${model}). Corpo recebido: ${JSON.stringify(data).slice(0, 500)}`,
        );
      }
      return { text: text.trim(), modelUsed: model };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Se for erro de chave inválida, propaga de imediato — nunca adianta trocar de modelo
      if (err instanceof GeminiInvalidKeyError) {
        throw err;
      }
      // Se ainda temos modelos candidatos, continua a iteração
      if (i < CANDIDATE_MODELS.length - 1) {
        continue;
      }
    }
  }

  throw (
    lastError ??
    new GeminiCallError("Todos os modelos Gemini falharam. Tente novamente em instantes.")
  );
}

/**
 * Tolerante a formato: tenta o atalho `output_text` primeiro; senão, prioriza
 * os steps do tipo `model_output` (resposta final do modelo) — importante
 * quando a ferramenta `google_search` está ativa, já que aí existem também
 * steps `google_search_call`/`google_search_result` cujo conteúdo (HTML de
 * sugestões de busca) poluiria a concatenação. Sem nenhum `model_output`,
 * cai de volta para catar texto de todos os steps (schema público não
 * garante o `type` em toda resposta antiga).
 */
function extractOutputText(data: InteractionResponse): string | null {
  if (typeof data.output_text === "string" && data.output_text.length > 0) {
    return data.output_text;
  }

  if (Array.isArray(data.steps)) {
    const modelOutputSteps = data.steps.filter((step) => step.type === "model_output");
    const relevantSteps = modelOutputSteps.length > 0 ? modelOutputSteps : data.steps;
    const pieces = relevantSteps
      .flatMap((step) => step.content ?? [])
      .filter((block) => typeof block.text === "string")
      .map((block) => block.text as string);
    if (pieces.length > 0) return pieces.join(" ");
  }

  return null;
}
