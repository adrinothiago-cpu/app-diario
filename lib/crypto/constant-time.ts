/**
 * Comparação de bytes em tempo constante. Necessária apenas para
 * verificadores comparados fora do crypto.subtle.verify (que já é
 * constant-time nativamente) — ex.: comparar um valor canário decifrado
 * manualmente. Sempre percorre todos os bytes, independente de onde a
 * primeira diferença ocorre.
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    const byteA = i < a.length ? a[i] : 0;
    const byteB = i < b.length ? b[i] : 0;
    diff |= byteA ^ byteB;
  }
  return diff === 0;
}
