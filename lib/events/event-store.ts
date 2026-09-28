/**
 * Log de eventos imutável e append-only. Nenhuma função de update/delete
 * aqui de propósito — correções viram novos eventos, nunca edição do que já
 * existe. `listDecryptedEvents` reconstrói o estado consolidado a partir do
 * log bruto, que continua sendo a fonte de verdade.
 */
import { decryptEvent, encryptEvent } from "@/lib/crypto/cipher";
import { getAllRecords, putRecord } from "@/lib/db/indexeddb";
import type { AppEvent, DecryptedEvent, StoredEvent } from "./types";

export const EVENT_APPENDED = "diario:event-appended";

export function generateEventId(): string {
  return `evt_${Date.now()}_${crypto.randomUUID()}`;
}

export async function appendEvent(key: CryptoKey, event: AppEvent): Promise<StoredEvent> {
  const blob = await encryptEvent(key, event);
  const stored: StoredEvent = { id: generateEventId(), createdAt: Date.now(), blob };
  await putRecord("events", stored);
  // Avisa a sincronização (`components/sync-provider.tsx`) que há evento novo pra subir.
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT_APPENDED));
  return stored;
}

export async function listDecryptedEvents(key: CryptoKey): Promise<DecryptedEvent[]> {
  const stored = await getAllRecords<StoredEvent>("events");
  const decrypted = await Promise.all(
    stored.map(async (record) => {
      const event = await decryptEvent<AppEvent>(key, record.blob);
      return { ...event, id: record.id, createdAt: record.createdAt } satisfies DecryptedEvent;
    }),
  );
  return decrypted.sort((a, b) => a.createdAt - b.createdAt);
}
