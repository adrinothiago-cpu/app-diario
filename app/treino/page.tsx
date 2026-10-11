"use client";

/**
 * Página da seção Treino: Treinador Pessoal com Memória Contínua.
 *
 * O usuário pode conversar por voz (áudio) ou texto relatando o que fez ou
 * pedindo o treino do dia. A IA interpreta, preenche e grava as séries
 * (`workout_set`) diretamente no cofre cifrado, e mantém uma memória viva
 * (`treino_memoria_atualizada`) do aluno, adaptando as próximas cargas e o
 * rodízio ABC.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { DevTag } from "@/components/dev-tag";
import { GeminiApiKeySettings } from "@/components/gemini-api-key-settings";
import { VaultGate } from "@/components/vault-gate";
import { useVault } from "@/components/vault-provider";
import { appendEvent, listDecryptedEvents } from "@/lib/events/event-store";
import { reduceSettings } from "@/lib/events/settings-store";
import {
  GRUPAMENTOS_PADRAO,
  reduceTodosExerciciosRealizados,
  reduceTreinoMemoria,
  reduceTreinoMensagens,
  reduceTreinoPlanos,
  TREINO_LETRAS,
  type TreinoConversaMensagem,
  type TreinoMemoria,
} from "@/lib/events/treino-store";
import type {
  DecryptedEvent,
  SettingsUpdatedEvent,
  TreinoLetra,
  TreinoPlano,
} from "@/lib/events/types";
import { GeminiInvalidKeyError } from "@/lib/gemini/client";
import { arrayBufferToBase64 } from "@/lib/audio/encoding";
import { formatDuration, useAudioRecorder } from "@/lib/audio/use-audio-recorder";
import {
  generateTreinoPlano,
  processarTurnoTreinador,
} from "@/lib/insights/gemini-treino";

function describeError(err: unknown): string {
  if (err instanceof GeminiInvalidKeyError) return "Chave da Gemini API inválida — troque abaixo.";
  return err instanceof Error ? err.message : String(err);
}

function tabClass(active: boolean): string {
  return `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
    active ? "bg-surface text-foreground shadow-sm" : "text-muted hover:bg-surface/60"
  }`;
}

export default function TreinoPage() {
  return (
    <main className="flex h-[calc(100dvh-56px)] flex-col gap-4 p-4 md:p-8">
      <DevTag id="app/treino/page.tsx#TreinoPage" />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Treino</h1>
        <p className="max-w-2xl text-sm text-muted">
          Seu treinador pessoal com memória. Diga ou digite o que você treinou
          para registrar automaticamente, ou peça o treino do dia adaptado ao
          seu histórico e cargas.
        </p>
      </div>
      <VaultGate>
        <TreinoContent />
      </VaultGate>
    </main>
  );
}

function TreinoContent() {
  const { key, dataVersion } = useVault();
  const [events, setEvents] = useState<DecryptedEvent[]>([]);
  const [view, setView] = useState<"treinador" | "historico" | "planos">("treinador");

  async function refresh() {
    if (!key) return;
    setEvents(await listDecryptedEvents(key));
  }

  useEffect(() => {
    if (!key) return;
    listDecryptedEvents(key).then(setEvents);
  }, [key, dataVersion]);

  const geminiApiKey = useMemo(() => reduceSettings(events).geminiApiKey, [events]);
  const planos = useMemo(() => reduceTreinoPlanos(events), [events]);
  const memoria = useMemo(() => reduceTreinoMemoria(events), [events]);
  const mensagens = useMemo(() => reduceTreinoMensagens(events), [events]);
  const exerciciosRealizados = useMemo(() => reduceTodosExerciciosRealizados(events), [events]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Abas Superiores */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border/50 pb-2">
        <button
          type="button"
          onClick={() => setView("treinador")}
          className={tabClass(view === "treinador")}
        >
          🤖 Treinador
        </button>
        <button
          type="button"
          onClick={() => setView("historico")}
          className={tabClass(view === "historico")}
        >
          📊 Histórico & Cargas ({exerciciosRealizados.length})
        </button>
        <button
          type="button"
          onClick={() => setView("planos")}
          className={tabClass(view === "planos")}
        >
          📋 Planos ABC
        </button>
      </div>

      {!geminiApiKey && (
        <div className="shrink-0 rounded-lg border border-amber-800/60 bg-amber-950/30 p-3 text-xs text-amber-300">
          Para conversar com o treinador e registrar seus treinos com IA, configure sua chave da Gemini API abaixo.
        </div>
      )}

      {/* Conteúdo da Aba */}
      <div className="flex min-h-0 flex-1 flex-col">
        {view === "treinador" && (
          <TreinadorView
            geminiApiKey={geminiApiKey}
            vaultKey={key}
            memoria={memoria}
            mensagens={mensagens}
            exerciciosRealizados={exerciciosRealizados}
            refresh={refresh}
          />
        )}
        {view === "historico" && (
          <HistoricoView exercicios={exerciciosRealizados} />
        )}
        {view === "planos" && (
          <PlanosView
            planos={planos}
            geminiApiKey={geminiApiKey}
            vaultKey={key}
            refresh={refresh}
          />
        )}
      </div>

      {/* Configuração de chave Gemini */}
      <div className="shrink-0 border-t border-border/40 pt-2">
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
    </div>
  );
}

// ============================================================================
// 1. VISÃO TREINADOR COM MEMÓRIA
// ============================================================================

function TreinadorView({
  geminiApiKey,
  vaultKey,
  memoria,
  mensagens,
  exerciciosRealizados,
  refresh,
}: {
  geminiApiKey: string | null;
  vaultKey: CryptoKey | null;
  memoria: TreinoMemoria | null;
  mensagens: TreinoConversaMensagem[];
  exerciciosRealizados: {
    exercicio: string;
    series: number;
    repeticoes: number;
    cargaKg: number;
    rpe: number;
    data: string;
  }[];
  refresh: () => Promise<void>;
}) {
  const [inputText, setInputText] = useState("");
  const [selectedPhoto, setSelectedPhoto] = useState<{ base64: string; mimeType: string; previewUrl: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const { recording, recordedSeconds, start, stop, cancel } = useAudioRecorder({
    onRecorded: async (audioBlob) => {
      await handleEnviarAudio(audioBlob);
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens, sending]);

  async function executarTurno(param: {
    texto?: string;
    audio?: { audioBase64: string; mimeType: string };
    imagem?: { imagemBase64: string; mimeType: string };
  }) {
    if (!vaultKey || !geminiApiKey) return;
    setSending(true);
    setError(null);

    try {
      // 1. Grava a mensagem do usuário no cofre
      let userMsgTexto = param.texto ?? "";
      if (param.imagem && !userMsgTexto) userMsgTexto = "📷 Foto de aparelho enviada";
      if (param.audio && !userMsgTexto) userMsgTexto = "🎙️ Áudio gravado";
      if (!userMsgTexto) userMsgTexto = "(mensagem sem texto)";

      await appendEvent(vaultKey, {
        type: "treino_mensagem_registrada",
        mensagemId: `msg_${Date.now()}_u`,
        autor: "usuario",
        texto: userMsgTexto,
      });

      // 2. Chama a IA do Treinador com a memória acumulada
      const resultado = await processarTurnoTreinador(geminiApiKey, {
        memoria,
        historicoExercicios: exerciciosRealizados,
        mensagensRecentes: mensagens,
        mensagemTexto: param.texto,
        audio: param.audio,
        imagem: param.imagem,
      });

      // 3. Se houver exercícios executados para registrar, cria os eventos workout_set
      const agora = new Date();
      const dataHoje = agora.toISOString().slice(0, 10);
      const horaHoje = agora.toTimeString().slice(0, 5);

      for (const s of resultado.seriesParaRegistrar) {
        await appendEvent(vaultKey, {
          type: "workout_set",
          Data: dataHoje,
          Hora_Inicio: horaHoje,
          Hora_Fim: horaHoje,
          Etapa: resultado.memoriaAtualizada.ultimoTreinoFeito ?? "A",
          Exercicio: s.exercicio,
          Series: s.series,
          Repeticoes: s.repeticoes,
          Carga_kg: s.cargaKg,
          RPE: s.rpe ?? 8,
          Observacoes: s.observacoes ?? "",
          Grupamento: s.grupamento,
          SessaoId: `treinador_${dataHoje}`,
        });
      }

      // 3.1 Se o treinador montou/preencheu um plano para a aba Planos ABC:
      if (resultado.planoParaPreencher) {
        const p = resultado.planoParaPreencher;
        await appendEvent(vaultKey, {
          type: "treino_plano_atualizado",
          treino: p.treino,
          grupamentos: GRUPAMENTOS_PADRAO[p.treino],
          exercicios: p.exercicios,
          modeloUsado: resultado.modeloUsado,
        });
      }

      // 4. Salva a memória atualizada
      await appendEvent(vaultKey, {
        type: "treino_memoria_atualizada",
        resumo: resultado.memoriaAtualizada.resumo,
        ultimoTreinoFeito: resultado.memoriaAtualizada.ultimoTreinoFeito,
        ultimoFocoFeito: resultado.memoriaAtualizada.ultimoFocoFeito,
        proximoTreinoSugerido: resultado.memoriaAtualizada.proximoTreinoSugerido,
        proximoFocoSugerido: resultado.memoriaAtualizada.proximoFocoSugerido,
        cargasChave: resultado.memoriaAtualizada.cargasChave,
        observacoesGerais: resultado.memoriaAtualizada.observacoesGerais,
        modeloUsado: resultado.modeloUsado,
      });

      // 5. Salva a resposta do treinador com as séries registradas
      await appendEvent(vaultKey, {
        type: "treino_mensagem_registrada",
        mensagemId: `msg_${Date.now()}_t`,
        autor: "treinador",
        texto: resultado.resposta,
        seriesRegistradas: resultado.seriesParaRegistrar.length > 0 ? resultado.seriesParaRegistrar : undefined,
      });

      await refresh();
      setInputText("");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSending(false);
    }
  }

  async function handleSelecionarFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const buffer = await file.arrayBuffer();
    const base64 = arrayBufferToBase64(buffer);
    const mimeType = file.type || "image/jpeg";
    const previewUrl = URL.createObjectURL(file);
    setSelectedPhoto({ base64, mimeType, previewUrl });
    if (photoInputRef.current) photoInputRef.current.value = "";
  }

  function handleRemoverFoto() {
    if (selectedPhoto?.previewUrl) URL.revokeObjectURL(selectedPhoto.previewUrl);
    setSelectedPhoto(null);
  }

  async function handleEnviarTexto() {
    if ((!inputText.trim() && !selectedPhoto) || sending) return;
    const imgParam = selectedPhoto
      ? { imagemBase64: selectedPhoto.base64, mimeType: selectedPhoto.mimeType }
      : undefined;
    handleRemoverFoto();
    await executarTurno({
      texto: inputText.trim() ? inputText.trim() : undefined,
      imagem: imgParam,
    });
  }

  async function handleEnviarAudio(audioBlob: Blob) {
    if (sending || audioBlob.size < 100) return;
    const buffer = await audioBlob.arrayBuffer();
    const audioBase64 = arrayBufferToBase64(buffer);
    const imgParam = selectedPhoto
      ? { imagemBase64: selectedPhoto.base64, mimeType: selectedPhoto.mimeType }
      : undefined;
    handleRemoverFoto();
    await executarTurno({
      texto: inputText.trim() ? inputText.trim() : undefined,
      audio: { audioBase64, mimeType: audioBlob.type || "audio/webm" },
      imagem: imgParam,
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Banner de Memória do Treinador */}
      <div className="shrink-0 rounded-xl border border-border/80 bg-surface/70 p-3 text-xs">
        <div className="flex items-center justify-between">
          <span className="font-medium text-foreground">🧠 Memória do Treinador</span>
          <span className="rounded bg-accent/20 px-2 py-0.5 text-[11px] font-semibold text-accent">
            Próximo: Treino {memoria?.proximoTreinoSugerido ?? "A"} ({memoria?.proximoFocoSugerido ?? "Peito"})
          </span>
        </div>
        <p className="mt-1 text-muted">
          {memoria?.resumo || "Ainda sem registros. Diga o que você treinou ou pergunte o treino de hoje."}
        </p>
      </div>

      {error && (
        <div className="shrink-0 rounded-lg border border-red-900/50 bg-red-950/30 p-2.5 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Feed de Mensagens */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-xl border border-border/50 bg-background/50 p-3">
        {mensagens.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-center text-muted">
            <div className="text-3xl">🏋️</div>
            <p className="max-w-sm text-sm">
              Olá Thiago! Eu sou seu treinador com memória. Me conte o que você
              treinou por voz 🎙️ ou texto, ou clique abaixo:
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => void executarTurno({ texto: "Qual é o meu treino de hoje?" })}
                disabled={sending || !geminiApiKey}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:border-accent disabled:opacity-50"
              >
                📋 Qual o meu treino de hoje?
              </button>
              <button
                type="button"
                onClick={() => setInputText("Hoje fiz ")}
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:border-accent"
              >
                ✍️ Quero relatar meu treino
              </button>
            </div>
          </div>
        )}

        {mensagens.map((msg) => {
          const isUser = msg.autor === "usuario";
          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}
            >
              <div
                className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm ${
                  isUser
                    ? "bg-accent text-background rounded-br-none font-medium"
                    : "bg-surface border border-border/60 text-foreground rounded-bl-none"
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.texto}</p>

                {/* Card de Séries Registradas */}
                {msg.seriesRegistradas && msg.seriesRegistradas.length > 0 && (
                  <div className="mt-2.5 rounded-lg border border-emerald-800/40 bg-emerald-950/20 p-2.5 text-xs">
                    <div className="font-semibold text-emerald-400">
                      ✅ Séries registradas no cofre:
                    </div>
                    <ul className="mt-1.5 space-y-1">
                      {msg.seriesRegistradas.map((s, idx) => (
                        <li key={idx} className="text-emerald-300">
                          <strong>{s.exercicio}</strong>
                          {s.grupamento ? ` (${s.grupamento})` : ""}: {s.series} séries x {s.repeticoes} reps com {s.cargaKg} kg
                          {s.rpe ? ` • RPE ${s.rpe}` : ""}
                          {s.observacoes ? ` — "${s.observacoes}"` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {sending && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="animate-spin">⏳</span> O treinador está analisando e registrando...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Barra de Entrada / Gravação */}
      <div className="shrink-0 space-y-2">
        {recording && (
          <div className="flex items-center justify-between rounded-lg border border-red-500/40 bg-red-950/30 px-3 py-2 text-xs text-red-300">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
              Gravando voz ({formatDuration(recordedSeconds)})
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={cancel}
                className="rounded px-2 py-1 text-muted hover:text-foreground"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={stop}
                className="rounded bg-red-600 px-3 py-1 font-medium text-white hover:bg-red-500"
              >
                Enviar áudio
              </button>
            </div>
          </div>
        )}

        {/* Pré-visualização da Foto Selecionada */}
        {selectedPhoto && (
          <div className="flex items-center justify-between rounded-xl border border-border/80 bg-surface/90 p-2 text-xs">
            <div className="flex items-center gap-2">
              <img
                src={selectedPhoto.previewUrl}
                alt="Foto do aparelho"
                className="h-12 w-12 rounded-lg object-cover border border-border"
              />
              <div>
                <span className="font-semibold text-foreground">Foto do aparelho pronta</span>
                <p className="text-[11px] text-muted">A IA vai identificar o aparelho e os músculos</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleRemoverFoto}
              className="rounded-lg px-2.5 py-1 text-xs text-muted hover:bg-surface hover:text-foreground"
            >
              Remover
            </button>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleEnviarTexto();
          }}
          className="flex items-center gap-2"
        >
          {/* Input oculto de foto/câmera */}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => void handleSelecionarFoto(e)}
          />

          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            title="Tirar foto do aparelho ou escolher da galeria"
            disabled={sending || recording || !geminiApiKey}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-lg text-foreground hover:border-accent disabled:opacity-50"
          >
            📷
          </button>

          <button
            type="button"
            onClick={recording ? stop : start}
            title={recording ? "Parar gravação" : "Gravar áudio"}
            disabled={sending || !geminiApiKey}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-lg transition-colors ${
              recording
                ? "border-red-500 bg-red-500 text-white"
                : "border-border bg-surface text-foreground hover:border-accent disabled:opacity-50"
            }`}
          >
            🎙️
          </button>
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={selectedPhoto ? "Opcional: tire dúvidas sobre o aparelho..." : "Diga o que treinou ou tire dúvidas..."}
            disabled={sending || recording || !geminiApiKey}
            className="h-10 flex-1 rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-accent disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={(!inputText.trim() && !selectedPhoto) || sending || !geminiApiKey}
            className="flex h-10 items-center justify-center rounded-xl bg-accent px-4 text-sm font-semibold text-background disabled:opacity-50"
          >
            Enviar
          </button>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// 2. VISÃO HISTÓRICO & CARGAS
// ============================================================================

function HistoricoView({
  exercicios,
}: {
  exercicios: {
    id: string;
    exercicio: string;
    grupamento: string | null;
    series: number;
    repeticoes: number;
    cargaKg: number;
    rpe: number;
    observacoes: string;
    data: string;
    criadoEm: number;
  }[];
}) {
  if (exercicios.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-muted">
        <p className="text-sm">Nenhuma série registrada ainda.</p>
        <p className="text-xs">
          Converse com o treinador na aba ao lado para registrar seus treinos.
        </p>
      </div>
    );
  }

  // Agrupa por exercício para ver evolução de carga
  const porExercicio = new Map<string, typeof exercicios>();
  for (const item of exercicios) {
    const list = porExercicio.get(item.exercicio) ?? [];
    list.push(item);
    porExercicio.set(item.exercicio, list);
  }

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-1">
      <div className="grid gap-3 sm:grid-cols-2">
        {[...porExercicio.entries()].map(([nome, lista]) => {
          const maxCarga = Math.max(...lista.map((i) => i.cargaKg));
          const maisRecente = lista[0];
          return (
            <div
              key={nome}
              className="rounded-xl border border-border/70 bg-surface/80 p-3.5 shadow-sm"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-foreground">{nome}</h3>
                  <p className="text-xs text-muted">
                    {maisRecente.grupamento || "Musculação"} • {lista.length} registro(s)
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-xs text-muted">Carga máx.</span>
                  <div className="text-base font-bold text-accent">{maxCarga} kg</div>
                </div>
              </div>

              <div className="mt-3 space-y-1.5 border-t border-border/40 pt-2 text-xs">
                <span className="font-medium text-muted">Últimos registros:</span>
                {lista.slice(0, 3).map((item) => (
                  <div key={item.id} className="flex justify-between text-muted">
                    <span>
                      {item.data}: {item.series}x{item.repeticoes} a {item.cargaKg}kg
                    </span>
                    <span>RPE {item.rpe}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// 3. VISÃO PLANOS ABC
// ============================================================================

function PlanosView({
  planos,
  geminiApiKey,
  vaultKey,
  refresh,
}: {
  planos: Record<TreinoLetra, TreinoPlano | null>;
  geminiApiKey: string | null;
  vaultKey: CryptoKey | null;
  refresh: () => Promise<void>;
}) {
  const [busyLetra, setBusyLetra] = useState<TreinoLetra | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleGerar(treino: TreinoLetra) {
    if (!vaultKey || !geminiApiKey) return;
    setBusyLetra(treino);
    setError(null);
    try {
      const grupamentos = planos[treino]?.grupamentos ?? GRUPAMENTOS_PADRAO[treino];
      const gerado = await generateTreinoPlano(geminiApiKey, { treino, grupamentos });
      await appendEvent(vaultKey, {
        type: "treino_plano_atualizado",
        treino,
        grupamentos,
        exercicios: gerado.exercicios,
        modeloUsado: gerado.modeloUsado,
      });
      await refresh();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusyLetra(null);
    }
  }

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-1">
      {error && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/30 p-2.5 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        {TREINO_LETRAS.map((letra) => {
          const plano = planos[letra];
          const grupamentos = plano?.grupamentos ?? GRUPAMENTOS_PADRAO[letra];
          return (
            <div
              key={letra}
              className="flex flex-col rounded-xl border border-border bg-surface/70 p-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-foreground">Treino {letra}</h3>
                  <p className="text-xs text-muted">{grupamentos.join(", ")}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleGerar(letra)}
                  disabled={busyLetra !== null || !geminiApiKey}
                  className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium text-foreground hover:border-accent disabled:opacity-50"
                >
                  {busyLetra === letra ? "Gerando…" : plano ? "Regenerar" : "Gerar"}
                </button>
              </div>

              <div className="mt-3 flex-1 space-y-1.5 border-t border-border/40 pt-2 text-xs">
                {plano && plano.exercicios.length > 0 ? (
                  plano.exercicios.map((ex, idx) => (
                    <div key={idx} className="flex justify-between py-0.5">
                      <span className="text-foreground">{ex.nome}</span>
                      <span className="text-muted">
                        {ex.series}x{ex.repeticoes} ({ex.grupamento})
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="py-4 text-center text-muted">
                    Nenhum exercício cadastrado. Clique em &quot;Gerar&quot; para a IA montar a ficha.
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
