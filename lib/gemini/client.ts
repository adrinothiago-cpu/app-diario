/**
 * Cliente HTTP genérico para a Gemini "Interactions API"
 * (`generativelanguage.googleapis.com/v1beta/interactions`) — sem nada
 * específico de transcrição ou de insights, só a chamada e a extração do
 * texto de saída. Usado por `lib/transcription/gemini.ts` (áudio → texto)
 * e `lib/insights/gemini-insights.ts` (texto → texto).
 *
 * A API é recente o suficiente para não haver garantia de que o formato
 * de resposta documentado hoje é estável — `extractOutputText` é
 * deliberadamente tolerante a variações razoáveis da estrutura, em vez de
 * assumir um único caminho fixo.
 */
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const MODEL = "gemini-3.8-flash";

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

export async function callGeminiInteraction(
  apiKey: string,
  input: InteractionInputBlock[],
): Promise<string> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, input }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new GeminiCallError(`Gemini API respondeu ${response.status}: ${body.slice(0, 300)}`);
  }

  const data: InteractionResponse = await response.json();
  const text = extractOutputText(data);
  if (text === null) {
    throw new GeminiCallError(
      `Não consegui extrair o texto da resposta da API. Corpo recebido: ${JSON.stringify(data).slice(0, 500)}`,
    );
  }
  return text.trim();
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
