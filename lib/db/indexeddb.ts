/**
 * Wrapper leve baseado em Promises sobre a IndexedDB nativa. Sem ORM: cada
 * store guarda registros como estão (structured clone), incluindo
 * ArrayBuffer bruto — sem serialização de texto no caminho de persistência.
 */

const DB_NAME = "diario-app";
const DB_VERSION = 1;

export const STORES = {
  events: "events",
  meta: "meta",
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
