import { describe, expect, it } from "vitest";
import { reduceSettings } from "./settings-store";
import type { DecryptedEvent } from "./types";

describe("reduceSettings", () => {
  it("retorna geminiApiKey null quando não há nenhum settings_updated", () => {
    expect(reduceSettings([]).geminiApiKey).toBeNull();
  });

  it("pega a chave do settings_updated mais recente", () => {
    const events: DecryptedEvent[] = [
      { type: "settings_updated", geminiApiKey: "chave-antiga", id: "e1", createdAt: 1 },
      { type: "settings_updated", geminiApiKey: "chave-nova", id: "e2", createdAt: 2 },
    ];
    expect(reduceSettings(events).geminiApiKey).toBe("chave-nova");
  });

  it("ignora eventos de outros tipos", () => {
    const events: DecryptedEvent[] = [{ type: "todo_created", todoId: "t1", texto: "x", id: "e1", createdAt: 1 }];
    expect(reduceSettings(events).geminiApiKey).toBeNull();
  });
});
