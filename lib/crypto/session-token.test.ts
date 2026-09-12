import { describe, expect, it } from "vitest";
import { createSessionToken, verifySessionToken } from "./session-token";
import { deriveMasterKeyBits, deriveSubkey, generateSalt } from "./keys";

async function testHmacKey() {
  const salt = generateSalt();
  const masterBits = await deriveMasterKeyBits("senha-correta", salt);
  return deriveSubkey(masterBits, "session-hmac");
}

describe("token de sessão (HMAC-SHA256)", () => {
  it("valida um token recém-criado", async () => {
    const key = await testHmacKey();
    const token = await createSessionToken(key, 60_000);
    expect(await verifySessionToken(key, token)).toBe(true);
  });

  it("rejeita token expirado", async () => {
    const key = await testHmacKey();
    const token = await createSessionToken(key, -1);
    expect(await verifySessionToken(key, token)).toBe(false);
  });

  it("rejeita token assinado com outra chave", async () => {
    const key = await testHmacKey();
    const otherKey = await testHmacKey();
    const token = await createSessionToken(key, 60_000);
    expect(await verifySessionToken(otherKey, token)).toBe(false);
  });

  it("rejeita payload adulterado", async () => {
    const key = await testHmacKey();
    const token = await createSessionToken(key, 60_000);
    const tamperedPayload = new TextEncoder().encode(
      JSON.stringify({ issuedAt: Date.now(), expiresAt: Date.now() + 999_999 }),
    ).buffer as ArrayBuffer;

    expect(await verifySessionToken(key, { ...token, payload: tamperedPayload })).toBe(false);
  });
});
