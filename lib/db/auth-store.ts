/**
 * Persistência do salt de derivação de chave e das tentativas de login
 * (rate-limit), usando a store "meta" do IndexedDB.
 */
import { getRecord, putRecord } from "./indexeddb";
import { isRateLimited, recordAttempt } from "@/lib/crypto/rate-limit";

interface MetaRecord<T> {
  key: string;
  value: T;
}

const SALT_KEY = "encryption_salt";
const LOGIN_ATTEMPTS_KEY = "login_attempts";

export async function getOrCreateSalt(): Promise<Uint8Array> {
  const existing = await getRecord<MetaRecord<ArrayBuffer>>("meta", SALT_KEY);
  if (existing) return new Uint8Array(existing.value);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  await putRecord("meta", { key: SALT_KEY, value: salt.buffer } satisfies MetaRecord<ArrayBuffer>);
  return salt;
}

/**
 * Troca o salt do cofre — usado só pela sincronização ao adotar o cofre de
 * outro aparelho (`lib/sync/sync.ts`), depois de recifrar todos os eventos
 * locais com a chave derivada do novo salt. O salt não é segredo.
 */
export async function setSalt(salt: Uint8Array): Promise<void> {
  await putRecord("meta", { key: SALT_KEY, value: salt.slice().buffer } satisfies MetaRecord<ArrayBuffer>);
}

export async function checkAndRecordLoginAttempt(): Promise<{ allowed: boolean }> {
  const now = Date.now();
  const record = await getRecord<MetaRecord<number[]>>("meta", LOGIN_ATTEMPTS_KEY);
  const attempts = record?.value ?? [];

  if (isRateLimited(attempts, now)) {
    return { allowed: false };
  }

  await putRecord("meta", {
    key: LOGIN_ATTEMPTS_KEY,
    value: recordAttempt(attempts, now),
  } satisfies MetaRecord<number[]>);
  return { allowed: true };
}
