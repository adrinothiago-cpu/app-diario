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

export function parseErrorMessage(status: number, rawBody: string): string {
  try {
    const parsed = JSON.parse(rawBody);
    const msg = parsed?.error?.message;
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
        body: JSON.stringify({ model, input }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const errorMsg = parseErrorMessage(response.status, body);

        // Erro fatal de credencial: chave explicitamente inválida falha imediatamente
        const isAuthInvalidKey =
          (response.status === 401 || response.status === 403) &&
          (body.includes("API_KEY_INVALID") ||
            body.includes("API key not valid") ||
            body.toLowerCase().includes("invalid api key"));

        if (isAuthInvalidKey) {
          throw new GeminiCallError(errorMsg);
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
      // Se for erro de chave inválida, propaga de imediato
      if (err instanceof GeminiCallError && err.message.toLowerCase().includes("invalid")) {
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
 * Tolerante a formato: tenta o atalho `output_text` primeiro; senão,
 * percorre `steps[].content[]` catando todo bloco de texto (sem exigir um
 * `type` exato de step, já que a doc pública não expõe o schema completo).
 */
function extractOutputText(data: InteractionResponse): string | null {
  if (typeof data.output_text === "string" && data.output_text.length > 0) {
    return data.output_text;
  }

  if (Array.isArray(data.steps)) {
    const pieces = data.steps
      .flatMap((step) => step.content ?? [])
      .filter((block) => typeof block.text === "string")
      .map((block) => block.text as string);
    if (pieces.length > 0) return pieces.join(" ");
  }

  return null;
}
