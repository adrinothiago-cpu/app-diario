/**
 * Resumo de insights de humor derivado do log de eventos.
 * Append-only como o resto do log: cada nova análise grava um evento
 * completo atualizado (`mood_insights_updated`), e o reducer pega sempre
 * o mais recente (o log cresce, mas o estado exibido não acumula).
 */
import type { DecryptedEvent, MoodInsights } from "./types";

export function reduceMoodInsights(events: DecryptedEvent[]): MoodInsights | null {
  let latest: MoodInsights | null = null;

  for (const event of events) {
    if (event.type === "mood_insights_updated") {
      latest = {
        resumoGeral: event.resumoGeral,
        gatilhosPositivos: event.gatilhosPositivos,
        gatilhosNegativos: event.gatilhosNegativos,
        sugestoesMelhoria: event.sugestoesMelhoria,
        tendencia: event.tendencia,
        baseadoEmEntradas: event.baseadoEmEntradas,
      };
    }
  }

  return latest;
}
