/**
 * Derivação de chaves: PBKDF2 (senha -> material mestre) + HKDF (material
 * mestre -> subchaves por finalidade). Duas subchaves nunca compartilham os
 * mesmos bits brutos entre algoritmos distintos (AES-GCM vs HMAC).
 */

export const PBKDF2_ITERATIONS = 600_000;
const MASTER_KEY_BITS = 256;

export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

/** PBKDF2-SHA256 da senha; retorna os bits brutos do material mestre (nunca a chave final). */
export async function deriveMasterKeyBits(
  password: string,
  salt: Uint8Array,
): Promise<ArrayBuffer> {
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    passwordKey,
    MASTER_KEY_BITS,
  );
}

export type SubkeyPurpose = "event-encryption" | "session-hmac";

/** HKDF-SHA256: deriva uma subchave isolada por finalidade a partir do material mestre. */
export async function deriveSubkey(
  masterKeyBits: ArrayBuffer,
  purpose: SubkeyPurpose,
): Promise<CryptoKey> {
  const hkdfKey = await crypto.subtle.importKey("raw", masterKeyBits, "HKDF", false, [
    "deriveKey",
  ]);
  const algorithm: HkdfParams = {
    name: "HKDF",
    hash: "SHA-256",
    salt: new Uint8Array(0),
    info: new TextEncoder().encode(purpose),
  };
  if (purpose === "event-encryption") {
    return crypto.subtle.deriveKey(algorithm, hkdfKey, { name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
  }
  return crypto.subtle.deriveKey(algorithm, hkdfKey, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}
