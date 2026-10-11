"use client";

/**
 * Página da seção Evolução: acompanhamento de questões pessoais/profissionais
 * não binárias via conversa com a Gemini API. Ver `ARCHITECTURE.md` sobre a
 * exceção de zero-knowledge e `lib/insights/gemini-evolucao.ts` sobre o
 * mecanismo de classificação incremental do diário e o turno de chat.
 *
 * Cada turno grava dois eventos: a memória atualizada do tópico
 * (`evolucao_rodada_registrada`: resumo + critérios) e as mensagens do chat
 * (`evolucao_mensagem_registrada`, uma por autor) — reabrir um tópico ou
 * recarregar a página recupera as bolhas de novo, ao custo de mais espaço no
 * cofre (trade-off aceito pelo Thiago).
 */
import { useEffect, useMemo, useState } from "react";
import { DevTag } from "@/components/dev-tag";
import { GeminiApiKeySettings } from "@/components/gemini-api-key-settings";
import { VaultGate } from "@/components/vault-gate";
import { useVault } from "@/components/vault-provider";
import { appendEvent, listDecryptedEvents } from "@/lib/events/event-store";
import { reduceDiaryEntries } from "@/lib/events/diary-store";
import { reduceEvolucaoClassificacoes, reduceEvolucaoTopicos } from "@/lib/events/evolucao-store";
import { reduceSettings } from "@/lib/events/settings-store";
import type { DecryptedEvent, DiaryEntryItem, EvolucaoTopico, MoodTrend, SettingsUpdatedEvent } from "@/lib/events/types";
import { GeminiInvalidKeyError } from "@/lib/gemini/client";
import {
  classifyDiaryEntries,
  computeVersaoTopicos,
  type ChatMensagem,
  generateChatTurn,
  selectEntriesForClassification,
  selectEntriesForNewTopic,
} from "@/lib/insights/gemini-evolucao";

const TREND_META: Record<MoodTrend, { label: string; icon: string; className: string }> = {
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
    label: "Sem dados suficientes",
    icon: "ℹ️",
    className: "border-border bg-background text-muted",
  },
};

function describeError(err: unknown): string {
  if (err instanceof GeminiInvalidKeyError) return "Chave da Gemini API inválida — troque abaixo.";
  return err instanceof Error ? err.message : String(err);
}

export default function EvolucaoPage() {
  return (
    <main className="flex h-[calc(100dvh-56px)] flex-col gap-4 p-8">
      <DevTag id="app/evolucao/page.tsx#EvolucaoPage" />
      <h1 className="text-2xl font-semibold tracking-tight">Evolução</h1>
      <p className="max-w-2xl text-sm text-muted">
        Converse sobre uma questão pessoal ou profissional que não se resolve
        marcando uma tarefa como feita — a Gemini API lê o que for relevante no
        seu diário, responde na conversa e atualiza uma memória compacta
        (resumo + critérios objetivos) pra acompanhar a evolução ao longo do
        tempo.
      </p>
      <VaultGate>
        <EvolucaoContent />
      </VaultGate>
    </main>
  );
}

function EvolucaoContent() {
  const { key, dataVersion } = useVault();
  const [events, setEvents] = useState<DecryptedEvent[]>([]);

  async function refresh() {
    if (!key) return;
    setEvents(await listDecryptedEvents(key));
  }

  useEffect(() => {
    if (!key) return;
    listDecryptedEvents(key).then(setEvents);
  }, [key, dataVersion]);

  const entries = useMemo(() => reduceDiaryEntries(events), [events]);
  const geminiApiKey = useMemo(() => reduceSettings(events).geminiApiKey, [events]);
  const topicos = useMemo(() => reduceEvolucaoTopicos(events), [events]);
  const classificacoes = useMemo(() => reduceEvolucaoClassificacoes(events), [events]);

  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMensagem[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const ativos = topicos.filter((t) => t.arquivadoEm === null);
  const arquivados = topicos.filter((t) => t.arquivadoEm !== null);
  const topicoSelecionado = ativos.find((t) => t.id === selectedTopicId) ?? null;

  function selectTopic(id: string | null) {
    setSelectedTopicId(id);
    const topico = id !== null ? topicos.find((t) => t.id === id) : undefined;
    setChatMessages(topico ? topico.mensagens.map((m) => ({ autor: m.autor, texto: m.texto })) : []);
    setError(null);
  }

  async function handleArchive(topico: EvolucaoTopico) {
    if (!key) return;
    await appendEvent(key, { type: "evolucao_topico_arquivado", topicoId: topico.id });
    if (selectedTopicId === topico.id) selectTopic(null);
    await refresh();
  }

  async function handleReopen(topico: EvolucaoTopico) {
    if (!key) return;
    await appendEvent(key, { type: "evolucao_topico_reaberto", topicoId: topico.id });
    await refresh();
  }

  /** Manda uma mensagem no chat. Só a criação do tópico lê um recorte do diário (Turno 1, abaixo); atualizações usam `handleUpdateFromDiary`, sob clique explícito. */
  async function handleSend(mensagem: string) {
    if (!key || !geminiApiKey) return;
    setSending(true);
    setError(null);
    try {
      if (topicoSelecionado === null) {
        // Turno 1: ainda não existe tópico — cria a partir da primeira mensagem,
        // já lendo o diário recente pra IA formar uma opinião com contexto real.
        const diaryContext = selectEntriesForNewTopic(entries);
        const gerado = await generateChatTurn(geminiApiKey, {
          topico: null,
          criteriosAnteriores: null,
          resumoAnterior: null,
          diaryContext,
          historicoConversa: chatMessages,
          mensagemAtual: mensagem,
        });
        const topicoId = crypto.randomUUID();
        await appendEvent(key, { type: "evolucao_topico_criado", topicoId, titulo: gerado.titulo! });
        if (diaryContext.length > 0) {
          const versaoTopicos = computeVersaoTopicos([...ativos, { id: topicoId }]);
          for (const e of diaryContext) {
            await appendEvent(key, {
              type: "evolucao_entrada_classificada",
              entryId: e.id,
              topicoId,
              versaoTopicos,
            });
          }
        }
        await appendEvent(key, {
          type: "evolucao_rodada_registrada",
          topicoId,
          criterios: gerado.criterios,
          resumo: gerado.resumo,
          tendencia: "sem_dados_suficientes",
          baseadoEmEntradas: diaryContext.length,
          modeloUsado: gerado.modeloUsado,
        });
        await appendEvent(key, { type: "evolucao_mensagem_registrada", topicoId, autor: "usuario", texto: mensagem });
        await appendEvent(key, { type: "evolucao_mensagem_registrada", topicoId, autor: "ia", texto: gerado.resposta });
        setSelectedTopicId(topicoId);
        setChatMessages((m) => [...m, { autor: "usuario", texto: mensagem }, { autor: "ia", texto: gerado.resposta }]);
        await refresh();
        return;
      }

      const ultimaRodada = topicoSelecionado.rodadas.at(-1) ?? null;
      const diaryContext = classificacoes
        .filter((c) => c.topicoId === topicoSelecionado.id && c.criadoEm > (ultimaRodada?.criadoEm ?? 0))
        .map((c) => entries.find((e) => e.id === c.entryId))
        .filter((e): e is DiaryEntryItem => e !== undefined);

      const gerado = await generateChatTurn(geminiApiKey, {
        topico: { titulo: topicoSelecionado.titulo },
        criteriosAnteriores: ultimaRodada?.criterios ?? null,
        resumoAnterior: ultimaRodada?.resumo ?? null,
        diaryContext,
        historicoConversa: chatMessages,
        mensagemAtual: mensagem,
      });
      await appendEvent(key, {
        type: "evolucao_rodada_registrada",
        topicoId: topicoSelecionado.id,
        criterios: gerado.criterios,
        resumo: gerado.resumo,
        tendencia: gerado.tendencia,
        baseadoEmEntradas: diaryContext.length,
        modeloUsado: gerado.modeloUsado,
      });
      await appendEvent(key, {
        type: "evolucao_mensagem_registrada",
        topicoId: topicoSelecionado.id,
        autor: "usuario",
        texto: mensagem,
      });
      await appendEvent(key, {
        type: "evolucao_mensagem_registrada",
        topicoId: topicoSelecionado.id,
        autor: "ia",
        texto: gerado.resposta,
      });
      setChatMessages((m) => [...m, { autor: "usuario", texto: mensagem }, { autor: "ia", texto: gerado.resposta }]);
      await refresh();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSending(false);
    }
  }

  /**
   * Botão "Atualizar com o diário": só aqui a leitura do diário acontece —
   * ação explícita do usuário, nunca disparada sozinha. Classifica entradas
   * pendentes (de todos os tópicos ativos) e regenera a memória deste tópico.
   */
  async function handleUpdateFromDiary() {
    if (!key || !geminiApiKey || !topicoSelecionado) return;
    setSending(true);
    setError(null);
    try {
      const pendentes = selectEntriesForClassification({ diaryEntries: entries, classificacoes, topicosAtivos: ativos });
      let classificacoesAtualizadas = classificacoes;
      if (pendentes.length > 0) {
        const versaoTopicos = computeVersaoTopicos(ativos);
        const novas = await classifyDiaryEntries(
          geminiApiKey,
          pendentes,
          ativos.map((t) => ({ id: t.id, titulo: t.titulo, descricao: t.descricao })),
        );
        for (const c of novas) {
          await appendEvent(key, {
            type: "evolucao_entrada_classificada",
            entryId: c.entryId,
            topicoId: c.topicoId,
            versaoTopicos,
          });
        }
        classificacoesAtualizadas = [
          ...classificacoes,
          ...novas.map((c) => ({ ...c, versaoTopicos, criadoEm: Date.now() })),
        ];
      }

      const ultimaRodada = topicoSelecionado.rodadas.at(-1) ?? null;
      const diaryContext = classificacoesAtualizadas
        .filter((c) => c.topicoId === topicoSelecionado.id && c.criadoEm > (ultimaRodada?.criadoEm ?? 0))
        .map((c) => entries.find((e) => e.id === c.entryId))
        .filter((e): e is DiaryEntryItem => e !== undefined);

      if (diaryContext.length === 0) {
        setError("Nenhuma entrada nova do diário pra este tópico.");
        return;
      }

      const gerado = await generateChatTurn(geminiApiKey, {
        topico: { titulo: topicoSelecionado.titulo },
        criteriosAnteriores: ultimaRodada?.criterios ?? null,
        resumoAnterior: ultimaRodada?.resumo ?? null,
        diaryContext,
        historicoConversa: chatMessages,
        mensagemAtual: null,
      });
      await appendEvent(key, {
        type: "evolucao_rodada_registrada",
        topicoId: topicoSelecionado.id,
        criterios: gerado.criterios,
        resumo: gerado.resumo,
        tendencia: gerado.tendencia,
        baseadoEmEntradas: diaryContext.length,
        modeloUsado: gerado.modeloUsado,
      });
      await appendEvent(key, {
        type: "evolucao_mensagem_registrada",
        topicoId: topicoSelecionado.id,
        autor: "ia",
        texto: gerado.resposta,
      });
      setChatMessages((m) => [...m, { autor: "ia", texto: gerado.resposta }]);
      await refresh();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 gap-6">
      <aside className="flex w-64 shrink-0 flex-col gap-3">
        <button
          type="button"
          onClick={() => selectTopic(null)}
          className={`rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
            selectedTopicId === null ? "bg-surface text-foreground" : "text-muted hover:bg-surface/60"
          }`}
        >
          + Nova conversa
        </button>

        <ul className="flex flex-col gap-1">
          {ativos.map((t) => {
            const ultima = t.rodadas.at(-1) ?? null;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => selectTopic(t.id)}
                  className={`flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors ${
                    selectedTopicId === t.id ? "bg-surface text-foreground" : "text-muted hover:bg-surface/60"
                  }`}
                >
                  <span className="truncate text-sm font-medium">{t.titulo}</span>
                  {ultima && <span className="truncate text-xs text-muted">{ultima.resumo}</span>}
                </button>
              </li>
            );
          })}
        </ul>

        {arquivados.length > 0 && (
          <div className="mt-auto flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className="w-fit text-xs text-muted hover:text-foreground"
            >
              {showArchived ? "Ocultar arquivados" : `Arquivados (${arquivados.length})`}
            </button>
            {showArchived && (
              <ul className="flex flex-col">
                {arquivados.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="flex-1 truncate text-xs text-muted line-through">{t.titulo}</span>
                    <button
                      type="button"
                      onClick={() => handleReopen(t)}
                      className="shrink-0 text-xs font-medium text-accent hover:underline"
                    >
                      Reabrir
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {!geminiApiKey && (
          <p className="rounded-lg border border-border bg-surface p-3 text-xs text-muted">
            Para conversar, configure sua chave da Gemini API abaixo.
          </p>
        )}

        {topicoSelecionado && (
          <TopicHeader topico={topicoSelecionado} onArchive={() => handleArchive(topicoSelecionado)} />
        )}

        <ChatPanel
          messages={chatMessages}
          isNewTopic={topicoSelecionado === null}
          sending={sending}
          canSend={!sending && !!geminiApiKey}
          onSend={(msg) => handleSend(msg)}
          onCheckDiary={topicoSelecionado ? handleUpdateFromDiary : undefined}
        />

        {error && (
          <div className="rounded-lg border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-400">
            Falha: {error}
          </div>
        )}

        <GeminiApiKeySettings
          currentKey={geminiApiKey}
          label={geminiApiKey ? "Chave da Gemini API configurada — trocar" : "Configurar Gemini API"}
          onSave={async (newKey) => {
            if (!key) return;
            const event: SettingsUpdatedEvent = { type: "settings_updated", geminiApiKey: newKey };
            await appendEvent(key, event);
            await refresh();
          }}
        />
      </div>

      <AuditPanel topicos={ativos} />
    </div>
  );
}

/** Visão geral pra auditar de relance o que a IA concluiu em cada tópico ativo — sem precisar abrir um por um. */
function AuditPanel({ topicos }: { topicos: EvolucaoTopico[] }) {
  return (
    <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto">
      <h2 className="text-sm font-medium text-muted">Resumo geral (auditoria)</h2>
      {topicos.length === 0 ? (
        <p className="text-sm text-muted">Nenhum tópico ativo ainda.</p>
      ) : (
        topicos.map((t) => {
          const ultima = t.rodadas.at(-1) ?? null;
          return (
            <div key={t.id} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="truncate text-sm font-medium">{t.titulo}</h3>
                {ultima && (
                  <span className={`shrink-0 text-xs ${TREND_META[ultima.tendencia].className.split(" ").find((c) => c.startsWith("text-"))}`}>
                    {TREND_META[ultima.tendencia].icon}
                  </span>
                )}
              </div>
              {ultima ? (
                <>
                  <p className="text-xs leading-relaxed text-muted">{ultima.resumo}</p>
                  <ul className="flex flex-col gap-1">
                    {ultima.criterios.map((c, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs">
                        <span className="shrink-0">{c.valor ? "✅" : "❌"}</span>
                        <span className="text-muted">{c.texto}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-xs text-muted">Sem rodada registrada ainda.</p>
              )}
            </div>
          );
        })
      )}
    </aside>
  );
}

function TopicHeader({ topico, onArchive }: { topico: EvolucaoTopico; onArchive: () => void }) {
  const ultima = topico.rodadas.at(-1) ?? null;

  return (
    <header className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-base font-medium">{topico.titulo}</h2>
        <div className="flex shrink-0 items-center gap-2">
          {ultima && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${TREND_META[ultima.tendencia].className}`}
            >
              <span>{TREND_META[ultima.tendencia].icon}</span>
              <span>{TREND_META[ultima.tendencia].label}</span>
            </span>
          )}
          {ultima?.modeloUsado && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent">
              <span>⚡ IA:</span>
              <span className="font-mono font-semibold">{ultima.modeloUsado}</span>
            </span>
          )}
          <button
            type="button"
            onClick={onArchive}
            className="whitespace-nowrap text-xs text-muted hover:text-foreground"
          >
            Arquivar
          </button>
        </div>
      </div>

      {ultima && <p className="text-sm leading-relaxed text-foreground">{ultima.resumo}</p>}

      {ultima && ultima.criterios.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {ultima.criterios.map((c, i) => (
            <li
              key={i}
              className={`rounded-md border px-2 py-1 text-xs ${
                c.valor
                  ? "border-emerald-800/60 bg-emerald-950/40 text-emerald-400"
                  : "border-amber-800/60 bg-amber-950/40 text-amber-400"
              }`}
            >
              {c.valor ? "✅" : "❌"} {c.texto}
            </li>
          ))}
        </ul>
      )}
    </header>
  );
}

function ChatPanel({
  messages,
  isNewTopic,
  sending,
  canSend,
  onSend,
  onCheckDiary,
}: {
  messages: ChatMensagem[];
  isNewTopic: boolean;
  sending: boolean;
  canSend: boolean;
  onSend: (mensagem: string) => void;
  onCheckDiary?: () => void;
}) {
  const [input, setInput] = useState("");

  function handleSubmit() {
    const texto = input.trim();
    if (texto === "" || !canSend) return;
    onSend(texto);
    setInput("");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-sm text-muted">
            {isNewTopic
              ? "Descreva o que está em aberto — uma relação, uma decisão, o que for. A primeira mensagem já começa o acompanhamento."
              : "Mande uma mensagem, ou clique em \"Atualizar com o diário\" pra ela reler o que você escreveu desde a última vez."}
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.autor === "usuario" ? "justify-end" : "justify-start"}`}>
            <p
              className={`max-w-[80%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm ${
                m.autor === "usuario" ? "bg-accent text-background" : "bg-background text-foreground"
              }`}
            >
              {m.texto}
            </p>
          </div>
        ))}
        {sending && <p className="text-xs text-muted">Pensando…</p>}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder={isNewTopic ? "Descreva a questão em aberto…" : "Escreva uma mensagem…"}
          disabled={!canSend}
          className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent disabled:opacity-50"
        />
        {onCheckDiary && (
          <button
            type="button"
            onClick={onCheckDiary}
            disabled={!canSend}
            className="shrink-0 whitespace-nowrap rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground disabled:opacity-50"
          >
            Atualizar com o diário
          </button>
        )}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSend || input.trim() === ""}
          className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          Enviar
        </button>
      </div>
    </div>
  );
}

