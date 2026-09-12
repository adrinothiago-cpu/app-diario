import { describe, expect, it } from "vitest";
import { arrayBufferToBase64, base64ToBlob } from "./encoding";

describe("arrayBufferToBase64 / base64ToBlob", () => {
  it("faz round-trip preservando os bytes originais", async () => {
    const original = new Uint8Array([0, 1, 2, 255, 254, 128, 10, 13]);
    const base64 = arrayBufferToBase64(original.buffer);
    const blob = base64ToBlob(base64, "audio/webm");
    const roundTripped = new Uint8Array(await blob.arrayBuffer());

    expect(blob.type).toBe("audio/webm");
    expect([...roundTripped]).toEqual([...original]);
  });

  it("lida com buffers maiores que o tamanho do bloco interno", async () => {
    const size = 0x8000 * 2 + 137; // força múltiplos blocos + resto
    const original = new Uint8Array(size).map((_, i) => i % 256);
    const base64 = arrayBufferToBase64(original.buffer);
    const roundTripped = new Uint8Array(await base64ToBlob(base64, "audio/webm").arrayBuffer());

    expect(roundTripped.length).toBe(size);
    expect([...roundTripped]).toEqual([...original]);
  });

  it("produz blob vazio para buffer vazio", async () => {
    const base64 = arrayBufferToBase64(new ArrayBuffer(0));
    const blob = base64ToBlob(base64, "audio/webm");
    expect(blob.size).toBe(0);
  });
});
