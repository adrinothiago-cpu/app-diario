/**
 * Conversão pura entre binário e base64 para o áudio das entradas de diário
 * (ver comentário em `lib/events/types.ts#DiaryEntryEvent`). Separado da
 * gravação em si (que depende de `MediaRecorder`/DOM) para poder ser testado
 * sem mocks de API de mídia.
 */

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  // Em blocos, para não estourar o limite de argumentos de
  // `String.fromCharCode(...bytes)` em áudios maiores.
  const CHUNK_SIZE = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}

export function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}
