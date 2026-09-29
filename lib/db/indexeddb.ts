/**
 * Wrapper leve baseado em Promises sobre a IndexedDB nativa. Sem ORM: cada
 * store guarda registros como estão (structured clone), incluindo
 * ArrayBuffer bruto — sem serialização de texto no caminho de persistência.
 */

const DB_NAME = "diario-app";
const DB_VERSION = 2;

export const STORES = {
  events: "events",
  meta: "meta",
  /** Eventos "arquivados" de uma sessão com senha diferente da do cofre atual — cifrados,
   *  fora da leitura normal do app, guardados só pra eventual recuperação (ver `lib/sync/sync.ts`). */
  quarantine: "quarantine",
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORES.events)) {
        db.createObjectStore(STORES.events, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.meta)) {
        db.createObjectStore(STORES.meta, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(STORES.quarantine)) {
        db.createObjectStore(STORES.quarantine, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function putRecord<T>(store: StoreName, value: T): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  await promisifyRequest(tx.objectStore(store).put(value));
}

export async function getRecord<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await openDb();
  const tx = db.transaction(store, "readonly");
  return promisifyRequest(tx.objectStore(store).get(key)) as Promise<T | undefined>;
}

export async function getAllRecords<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  const tx = db.transaction(store, "readonly");
  return promisifyRequest(tx.objectStore(store).getAll()) as Promise<T[]>;
}

export async function deleteRecord(store: StoreName, key: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  await promisifyRequest(tx.objectStore(store).delete(key));
}

/** Apaga todos os registros de uma store. Usado só depois de copiar os eventos pra `quarantine` (`lib/sync/sync.ts`) — nunca sozinho, sem antes preservar os dados. */
export async function clearStore(store: StoreName): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  await promisifyRequest(tx.objectStore(store).clear());
}
