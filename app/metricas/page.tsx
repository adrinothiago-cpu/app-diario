"use client";

/**
 * Página de Métricas e Insights de Humor via Gemini API.
 * Analisa as entradas recentes do diário para extrair padrões, gatilhos
 * e sugestões. O resumo gerado evolui a cada rodada (append-only, reduzido
 * para o mais recente).
 */
import { useEffect, useState } from "react";
import { DevTag } from "@/components/dev-tag";
import { GeminiApiKeySettings } from "@/components/gemini-api-key-settings";
import { VaultGate } from "@/components/vault-gate";
import { useVault } from "@/components/vault-provider";
import { appendEvent, listDecryptedEvents } from "@/lib/events/event-store";
import { reduceDiaryEntries } from "@/lib/events/diary-store";
import { reduceMoodInsights } from "@/lib/events/mood-insights-store";
import { reduceSettings } from "@/lib/events/settings-store";
import type { DiaryEntryItem, MoodInsights, MoodTrend, SettingsUpdatedEvent } from "@/lib/events/types";
import {
  generateMoodInsights,
  selectEntriesForInsights,
} from "@/lib/insights/gemini-insights";

const TREND_META: Record<
  MoodTrend,
  { label: string; icon: string; className: string }
> = {
  melhorando: {
    label: "Melhorando",
    icon: "📈",
    className: "border-emerald-800/60 bg-emerald-950/40 text-emerald-400",
  },
  piorando: {
    label: "Piorando",
    icon: "📉",
    className: "border-amber-800/60 bg-amber-950/40 text-amber-400",
  },
  estavel: {
    label: "Estável",
    icon: "➡️",
    className: "border-blue-800/60 bg-blue-950/40 text-blue-400",
  },
  sem_dados_suficientes: {
    label: "Sem dados suficientes para tendência",
    icon: "ℹ️",
    className: "border-border bg-background text-muted",
  },
};

export default function MetricasPage() {
  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <DevTag id="app/metricas/page.tsx#MetricasPage" />
      <h1 className="text-2xl font-semibold tracking-tight">Métricas & Insights</h1>
      <p className="max-w-2xl text-sm text-muted">
        Análise evolutiva de humor usando a Gemini API. Ao atualizar, o texto de até
        30 entradas recentes do seu diário é enviado ao modelo para identificar
        gatilhos e sugestões de bem-estar.
      </p>
      <VaultGate>
        <MetricasContent />
      </VaultGate>
    </main>
  );
}

function MetricasContent() {
  const { key } = useVault();
  const [entries, setEntries] = useState<DiaryEntryItem[]>([]);
  const [geminiApiKey, setGeminiApiKey] = useState<string | null>(null);
  const [insights, setInsights] = useState<MoodInsights | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!key) return;
    const decrypted = await listDecryptedEvents(key);
    setEntries(reduceDiaryEntries(decrypted));
    setGeminiApiKey(reduceSettings(decrypted).geminiApiKey);
    setInsights(reduceMoodInsights(decrypted));
  }

  useEffect(() => {
    if (!key) return;
    listDecryptedEvents(key).then((decrypted) => {
      setEntries(reduceDiaryEntries(decrypted));
      setGeminiApiKey(reduceSettings(decrypted).geminiApiKey);
      setInsights(reduceMoodInsights(decrypted));
    });
  }, [key]);

  const eligible = selectEntriesForInsights(entries);

  async function handleGenerateInsights() {
    if (!key || !geminiApiKey || eligible.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const generated = await generateMoodInsights(geminiApiKey, entries, insights);
      await appendEvent(key, {
        type: "mood_insights_updated",
        resumoGeral: generated.resumoGeral,
        gatilhosPositivos: generated.gatilhosPositivos,
        gatilhosNegativos: generated.gatilhosNegativos,
        sugestoesMelhoria: generated.sugestoesMelhoria,
        tendencia: generated.tendencia,
        baseadoEmEntradas: generated.baseadoEmEntradas,
        modeloUsado: generated.modeloUsado,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const canGenerate = !busy && !!geminiApiKey && eligible.length > 0;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium">Insights de humor</h2>
            <p className="text-xs text-muted">
              {eligible.length === 0
                ? "Nenhuma entrada com texto ou transcrição no diário ainda."
                : `${eligible.length} ${
                    eligible.length === 1 ? "entrada elegível" : "entradas elegíveis"
                  } no diário para análise.`}
            </p>
          </div>

          <button
            type="button"
            onClick={handleGenerateInsights}
            disabled={!canGenerate}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-background transition-opacity disabled:opacity-50"
          >
            {busy
              ? "Analisando com Gemini…"
              : insights
              ? "Atualizar insights"
              : "Gerar primeiros insights"}
          </button>
        </div>

        {!geminiApiKey && (
          <p className="rounded-lg border border-border bg-background p-3 text-xs text-muted">
            Para gerar insights, configure sua chave da Gemini API abaixo.
          </p>
        )}

        {error && (
          <div className="rounded-lg border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-400">
            Falha ao gerar insights: {error}
          </div>
        )}
      </section>

      {insights ? (
        <article className="flex flex-col gap-5 rounded-xl border border-border bg-surface p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-4">
            <div
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                TREND_META[insights.tendencia].className
              }`}
            >
              <span>{TREND_META[insights.tendencia].icon}</span>
              <span>Tendência: {TREND_META[insights.tendencia].label}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">
                Baseado nas {insights.baseadoEmEntradas}{" "}
                {insights.baseadoEmEntradas === 1 ? "entrada" : "entradas"} mais recentes
              </span>
              {insights.modeloUsado && (
                <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[11px] text-muted">
                  <span>⚡</span>
                  <span>
                    Modelo: <strong className="font-medium text-foreground">{insights.modeloUsado}</strong>
                  </span>
                </span>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
              Resumo Geral
            </h3>
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {insights.resumoGeral}
            </p>
          </div>

          {insights.gatilhosPositivos.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                Gatilhos Positivos
              </h3>
              <ul className="mt-2 space-y-1.5">
                {insights.gatilhosPositivos.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                    <span className="text-emerald-400">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {insights.gatilhosNegativos.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-400">
                Gatilhos Negativos
              </h3>
              <ul className="mt-2 space-y-1.5">
                {insights.gatilhosNegativos.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                    <span className="text-amber-400">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {insights.sugestoesMelhoria.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-accent">
                Sugestões de Melhoria
              </h3>
              <ul className="mt-2 space-y-1.5">
                {insights.sugestoesMelhoria.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                    <span className="text-accent">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </article>
      ) : (
        <section className="rounded-xl border border-dashed border-border bg-surface/50 p-8 text-center">
          <p className="text-sm font-medium text-foreground">Nenhum insight gerado ainda</p>
          <p className="mt-1 text-xs text-muted">
            Registre suas entradas no diário e clique em &quot;Gerar primeiros insights&quot;
            para ver padrões e sugestões de humor.
          </p>
        </section>
      )}

      <GeminiApiKeySettings
        currentKey={geminiApiKey}
        label={geminiApiKey ? "Chave da Gemini API configurada — trocar" : "Configurar Gemini API"}
        onSave={async (newKey) => {
          if (!key) return;
          const event: SettingsUpdatedEvent = { type: "settings_updated", geminiApiKey: newKey };
          await appendEvent(key, event);
          setGeminiApiKey(newKey);
        }}
      />
    </div>
  );
}
