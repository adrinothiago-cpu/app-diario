/**
 * Transcrição de áudio via Gemini API. Exceção explícita de
 * zero-knowledge — decisão registrada em `ARCHITECTURE.md`: o áudio da
 * voz sai do aparelho e é processado pelo Google. Só é chamada quando o
 * usuário aperta "Transcrever" numa entrada específica, nunca
 * automaticamente.
 *
 * Wrapper fino sobre `lib/gemini/client.ts` — a chamada HTTP e a
 * extração de texto genéricas vivem lá; aqui só o prompt e o
 * envelopamento de erro específicos de transcrição.
 */
import { callGeminiInteraction, GeminiCallError } from "@/lib/gemini/client";

const PROMPT =
  "Transcreva este áudio em português (pt-BR). Responda apenas com o texto " +
  "transcrito, sem comentários, sem aspas, sem marcações adicionais.";

export class TranscriptionError extends Error {}

export async function transcribeAudio(
  apiKey: string,
  audioBase64: string,
  mimeType: string,
): Promise<string> {
  try {
    return await callGeminiInteraction(apiKey, [
      { type: "text", text: PROMPT },
      { type: "audio", data: audioBase64, mime_type: mimeType },
    ]);
  } catch (err) {
    if (err instanceof GeminiCallError) throw new TranscriptionError(err.message);
    throw err;
  }
}
