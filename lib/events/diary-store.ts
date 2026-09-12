/**
 * Deriva a lista de entradas de diário a partir do log de eventos. Ao
 * contrário de tarefas, `diary_entry` ainda não tem eventos de delta — cada
 * evento já É a entrada completa, então a "redução" é só mapear e ordenar
 * (mais recente primeiro, como um feed).
 */
import type { DecryptedEvent, DiaryEntryItem } from "./types";

export function reduceDiaryEntries(events: DecryptedEvent[]): DiaryEntryItem[] {
  const entries: DiaryEntryItem[] = [];

  for (const event of events) {
    if (event.type !== "diary_entry") continue;
    entries.push({
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
      criadoEm: event.createdAt,
    });
  }

  return entries.sort((a, b) => b.criadoEm - a.criadoEm);
}
