/**
 * Token de sessão assinado com HMAC-SHA256, com expiração embutida.
 * Payload e assinatura ficam em binário puro (sem base64/JWT de texto) —
 * o token só circula dentro do próprio processo/IndexedDB, nunca em uma
 * URL ou header HTTP, então não há motivo para pagar o custo de string.
 */

export interface SessionToken {
  payload: ArrayBuffer;
  signature: ArrayBuffer;
}

interface SessionPayload {
  issuedAt: number;
  expiresAt: number;
}

export async function createSessionToken(
  hmacKey: CryptoKey,
  ttlMs: number,
): Promise<SessionToken> {
  const payloadObj: SessionPayload = { issuedAt: Date.now(), expiresAt: Date.now() + ttlMs };
  const payload = new TextEncoder().encode(JSON.stringify(payloadObj)).buffer as ArrayBuffer;
  const signature = await crypto.subtle.sign("HMAC", hmacKey, payload);
  return { payload, signature };
}

/** crypto.subtle.verify já compara a tag em tempo constante — não reimplementar isso manualmente. */
export async function verifySessionToken(
  hmacKey: CryptoKey,
  token: SessionToken,
): Promise<boolean> {
  const valid = await crypto.subtle.verify("HMAC", hmacKey, token.signature, token.payload);
  if (!valid) return false;

  const payload = JSON.parse(new TextDecoder().decode(token.payload)) as SessionPayload;
  return Date.now() < payload.expiresAt;
}
