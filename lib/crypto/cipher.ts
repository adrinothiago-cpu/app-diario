/**
 * AES-GCM 256 sobre payload JSON, empacotado como blob binário puro
 * (IV de 12 bytes || ciphertext+tag) — sem base64. IndexedDB e o upload
 * para o Drive lidam com bytes nativamente, então esse é o formato mais
 * rápido tanto para gravar/ler quanto para sincronizar: nenhuma camada de
 * texto entre a chave e o disco.
 */

const IV_LENGTH = 12;

export async function encryptEvent(key: CryptoKey, data: unknown): Promise<ArrayBuffer> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, plaintext),
  );

  const blob = new Uint8Array(IV_LENGTH + ciphertext.length);
  blob.set(iv, 0);
  blob.set(ciphertext, IV_LENGTH);
  return blob.buffer;
}

export async function decryptEvent<T>(key: CryptoKey, blob: ArrayBuffer): Promise<T> {
  const bytes = new Uint8Array(blob);
  const iv = bytes.slice(0, IV_LENGTH);
  const ciphertext = bytes.slice(IV_LENGTH);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ciphertext as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}
