import { describe, expect, it } from "vitest";
import { reduceMoodInsights } from "./mood-insights-store";
import type { DecryptedEvent } from "./types";

describe("reduceMoodInsights", () => {
  it("retorna null quando não há nenhum mood_insights_updated", () => {
    expect(reduceMoodInsights([])).toBeNull();
  });

  it("pega o mood_insights_updated mais recente", () => {
    const events: DecryptedEvent[] = [
      {
        type: "mood_insights_updated",
        resumoGeral: "Resumo antigo",
        gatilhosPositivos: ["Sol"],
        gatilhosNegativos: ["Trânsito"],
        sugestoesMelhoria: ["Dormir mais"],
        tendencia: "sem_dados_suficientes",
        baseadoEmEntradas: 5,
        id: "e1",
        createdAt: 1,
      },
      {
        type: "mood_insights_updated",
        resumoGeral: "Resumo novo",
        gatilhosPositivos: ["Treino", "Sol"],
        gatilhosNegativos: ["Falta de sono"],
        sugestoesMelhoria: ["Meditar"],
        tendencia: "melhorando",
        baseadoEmEntradas: 10,
        modeloUsado: "gemini-3.8-flash",
        id: "e2",
        createdAt: 2,
      },
    ];

    expect(reduceMoodInsights(events)).toEqual({
      resumoGeral: "Resumo novo",
      gatilhosPositivos: ["Treino", "Sol"],
      gatilhosNegativos: ["Falta de sono"],
      sugestoesMelhoria: ["Meditar"],
      tendencia: "melhorando",
      baseadoEmEntradas: 10,
      modeloUsado: "gemini-3.8-flash",
    });
  });

  it("ignora eventos de outros tipos", () => {
    const events: DecryptedEvent[] = [
      { type: "todo_created", todoId: "t1", texto: "x", id: "e1", createdAt: 1 },
      { type: "settings_updated", geminiApiKey: "k", id: "e2", createdAt: 2 },
    ];
    expect(reduceMoodInsights(events)).toBeNull();
  });
});
