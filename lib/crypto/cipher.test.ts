import { describe, expect, it } from "vitest";
import { decryptEvent, encryptEvent } from "./cipher";
import { deriveMasterKeyBits, deriveSubkey, generateSalt } from "./keys";

async function testKey(password = "senha-correta") {
  const salt = generateSalt();
  const masterBits = await deriveMasterKeyBits(password, salt);
  return deriveSubkey(masterBits, "event-encryption");
}

describe("cifra de eventos (AES-GCM binário)", () => {
  it("faz round-trip de um payload JSON", async () => {
    const key = await testKey();
    const payload = { type: "workout_set", Exercicio: "Supino", Carga_kg: 80 };

    const blob = await encryptEvent(key, payload);
    const decrypted = await decryptEvent<typeof payload>(key, blob);

    expect(decrypted).toEqual(payload);
  });

  it("produz um blob binário sem base64/JSON de envelope", async () => {
    const key = await testKey();
    const blob = await encryptEvent(key, { a: 1 });
    expect(blob).toBeInstanceOf(ArrayBuffer);
    // IV (12) + tag (16) + ao menos 1 byte de ciphertext
    expect(blob.byteLength).toBeGreaterThan(12 + 16);
  });

  it("falha ao decifrar com a chave errada", async () => {
    const key = await testKey("senha-correta");
    const wrongKey = await testKey("senha-errada");
    const blob = await encryptEvent(key, { segredo: 42 });

    await expect(decryptEvent(wrongKey, blob)).rejects.toThrow();
  });

  it("detecta blob adulterado (integridade do AEAD)", async () => {
    const key = await testKey();
    const blob = await encryptEvent(key, { valor: "original" });
    const tampered = new Uint8Array(blob);
    tampered[tampered.length - 1] ^= 0xff;

    await expect(decryptEvent(key, tampered.buffer)).rejects.toThrow();
  });
});
