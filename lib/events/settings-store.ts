/**
 * Configurações do app derivadas do log — hoje só a chave de API do
 * Gemini. Append-only como o resto: pega sempre o `settings_updated` mais
 * recente (trocar a chave é só gravar um evento novo).
 */
import type { DecryptedEvent } from "./types";

export interface AppSettings {
  geminiApiKey: string | null;
}

export function reduceSettings(events: DecryptedEvent[]): AppSettings {
  let geminiApiKey: string | null = null;

  for (const event of events) {
    if (event.type === "settings_updated") {
      geminiApiKey = event.geminiApiKey;
    }
  }

  return { geminiApiKey };
}
