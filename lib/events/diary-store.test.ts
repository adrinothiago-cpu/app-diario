import { describe, expect, it } from "vitest";
import { reduceDiaryEntries } from "./diary-store";
import type { DecryptedEvent } from "./types";

const entry = (
  id: string,
  createdAt: number,
  extra: Partial<{
    Conteudo: string;
    Humor: 1 | 2 | 3 | 4 | 5;
    audioBase64: string;
    audioMimeType: string;
    audioDuracaoSeg: number;
  }> = {},
): DecryptedEvent => ({
  type: "diary_entry",
  Conteudo: "",
  Humor: 3,
  Horario: "10:00",
  latitude: null,
  longitude: null,
  precisao: null,
  ...extra,
  id,
  createdAt,
});

describe("reduceDiaryEntries", () => {
  it("ignora eventos de outros tipos", () => {
    const events: DecryptedEvent[] = [
      { type: "todo_created", todoId: "t1", texto: "x", id: "e1", createdAt: 1 },
      entry("e2", 2),
    ];
    expect(reduceDiaryEntries(events)).toHaveLength(1);
  });

  it("ordena da entrada mais recente para a mais antiga", () => {
    const events = [entry("e1", 100), entry("e2", 300), entry("e3", 200)];
    expect(reduceDiaryEntries(events).map((e) => e.id)).toEqual(["e2", "e3", "e1"]);
  });

  it("preserva os campos de áudio quando presentes", () => {
    const events = [
      entry("e1", 1, {
        Conteudo: "",
        audioBase64: "QUJD",
        audioMimeType: "audio/webm",
        audioDuracaoSeg: 12,
      }),
    ];
    const [item] = reduceDiaryEntries(events);
    expect(item.audioBase64).toBe("QUJD");
    expect(item.audioMimeType).toBe("audio/webm");
    expect(item.audioDuracaoSeg).toBe(12);
  });

  it("retorna null nos campos de áudio quando a entrada é só texto", () => {
    const events = [entry("e1", 1, { Conteudo: "Dia tranquilo." })];
    const [item] = reduceDiaryEntries(events);
    expect(item.conteudo).toBe("Dia tranquilo.");
    expect(item.audioBase64).toBeNull();
    expect(item.audioMimeType).toBeNull();
    expect(item.audioDuracaoSeg).toBeNull();
  });
});
