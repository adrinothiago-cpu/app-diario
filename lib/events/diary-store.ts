/**
 * Deriva a lista de entradas de diário a partir do log de eventos.
 * `diary_entry` em si não tem delta (cada evento já é a entrada completa),
 * mas `diary_transcription_added` é aplicado por cima usando um Map por
 * `entryId` — mesmo padrão de reduce por chave usado em `todo-store.ts`.
 */
import type { DecryptedEvent, DiaryEntryItem } from "./types";

export function reduceDiaryEntries(events: DecryptedEvent[]): DiaryEntryItem[] {
  const entries = new Map<string, DiaryEntryItem>();

  for (const event of events) {
    if (event.type === "diary_entry") {
      entries.set(event.id, {
        id: event.id,
        conteudo: event.Conteudo,
        humor: event.Humor,
        horario: event.Horario,
        latitude: event.latitude,
        longitude: event.longitude,
        precisao: event.precisao,
        audioBase64: event.audioBase64 ?? null,
        audioMimeType: event.audioMimeType ?? null,
        audioDuracaoSeg: event.audioDuracaoSeg ?? null,
        transcricao: null,
        criadoEm: event.createdAt,
      });
    } else if (event.type === "diary_transcription_added") {
      const existing = entries.get(event.entryId);
      if (existing) existing.transcricao = event.texto;
    }
  }

  return [...entries.values()].sort((a, b) => b.criadoEm - a.criadoEm);
}
