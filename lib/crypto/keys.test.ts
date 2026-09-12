import { describe, expect, it } from "vitest";
import { deriveMasterKeyBits, deriveSubkey, generateSalt } from "./keys";

describe("derivação de chaves", () => {
  it("gera a mesma chave para a mesma senha e salt", async () => {
    const salt = generateSalt();
    const bits1 = await deriveMasterKeyBits("senha-correta", salt);
    const bits2 = await deriveMasterKeyBits("senha-correta", salt);
    expect(new Uint8Array(bits1)).toEqual(new Uint8Array(bits2));
  });

  it("gera chaves diferentes para senhas diferentes", async () => {
    const salt = generateSalt();
    const bits1 = await deriveMasterKeyBits("senha-a", salt);
    const bits2 = await deriveMasterKeyBits("senha-b", salt);
    expect(new Uint8Array(bits1)).not.toEqual(new Uint8Array(bits2));
  });

  it("deriva subchaves distintas para finalidades distintas", async () => {
    const salt = generateSalt();
    const masterBits = await deriveMasterKeyBits("senha-correta", salt);
    const encryptionKey = await deriveSubkey(masterBits, "event-encryption");
    const hmacKey = await deriveSubkey(masterBits, "session-hmac");

    expect(encryptionKey.algorithm.name).toBe("AES-GCM");
    expect(hmacKey.algorithm.name).toBe("HMAC");
    expect(encryptionKey.extractable).toBe(false);
  });
});
