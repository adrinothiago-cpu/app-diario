"use client";

/**
 * Módulo Diário: entradas com texto opcional, humor e/ou uma gravação de
 * voz. O áudio em si fica só como blob cifrado local (gravar e salvar não
 * fazem nenhuma chamada de rede). Transcrever é uma ação manual à parte,
 * por botão — usa a Gemini API e é a única exceção de zero-knowledge do
 * projeto (ver `ARCHITECTURE.md`): o áudio daquela entrada específica sai
 * do aparelho só quando você pede.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { DevTag } from "@/components/dev-tag";
import { BiometricUnlockSettings } from "@/components/biometric-unlock-settings";
import { GeminiApiKeySettings } from "@/components/gemini-api-key-settings";
import { VaultGate } from "@/components/vault-gate";
import { useVault } from "@/components/vault-provider";
import { arrayBufferToBase64, base64ToBlob } from "@/lib/audio/encoding";
import { type AudioRecorder, formatDuration, useAudioRecorder } from "@/lib/audio/use-audio-recorder";
import { appendEvent, listDecryptedEvents } from "@/lib/events/event-store";
import { reduceDiaryEntries } from "@/lib/events/diary-store";
import { reduceSettings } from "@/lib/events/settings-store";
import type { DiaryEntryEvent, DiaryEntryItem, SettingsUpdatedEvent } from "@/lib/events/types";
import { transcribeAudio } from "@/lib/transcription/gemini";

const HUMOR_EMOJI: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "😞",
  2: "🙁",
  3: "😐",
  4: "🙂",
  5: "😄",
};

export default function DiarioPage() {
  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <DevTag id="app/diario/page.tsx#DiarioPage" />
      <h1 className="text-2xl font-semibold tracking-tight">Diário</h1>
      <p className="max-w-2xl text-sm text-muted">
        Escreva, marque seu humor e/ou grave um áudio. Tudo fica cifrado
        localmente. Transcrever um áudio é opcional e manual — só nesse caso
        o áudio daquela entrada é enviado para a Gemini API.
      </p>
      <VaultGate>
        <DiaryContent />
      </VaultGate>
    </main>
  );
}

function DiaryContent() {
  const { key, dataVersion } = useVault();
  const [entries, setEntries] = useState<DiaryEntryItem[]>([]);
  const [geminiApiKey, setGeminiApiKey] = useState<string | null>(null);
  const [conteudo, setConteudo] = useState("");
  const [humor, setHumor] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [busy, setBusy] = useState(false);

  const recorder = useAudioRecorder();

  async function refresh() {
    if (!key) return;
    const decrypted = await listDecryptedEvents(key);
    setEntries(reduceDiaryEntries(decrypted));
    setGeminiApiKey(reduceSettings(decrypted).geminiApiKey);
  }

  useEffect(() => {
    if (!key) return;
    listDecryptedEvents(key).then((decrypted) => {
      setEntries(reduceDiaryEntries(decrypted));
      setGeminiApiKey(reduceSettings(decrypted).geminiApiKey);
    });
  }, [key, dataVersion]);

  async function handleSave() {
    if (!key) return;
    if (conteudo.trim() === "" && !recorder.recordedBlob) return;

    setBusy(true);
    try {
      const now = new Date();
      const event: DiaryEntryEvent = {
        type: "diary_entry",
        Conteudo: conteudo.trim(),
        Humor: humor,
        Horario: now.toTimeString().slice(0, 5),
        latitude: null,
        longitude: null,
        precisao: null,
      };

      if (recorder.recordedBlob) {
        event.audioBase64 = arrayBufferToBase64(await recorder.recordedBlob.arrayBuffer());
        event.audioMimeType = recorder.recordedBlob.type;
        event.audioDuracaoSeg = recorder.recordedSeconds;
      }

      await appendEvent(key, event);
      setConteudo("");
      setHumor(3);
      recorder.discard();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const canSave = !busy && (conteudo.trim() !== "" || recorder.recordedBlob !== null);

  return (
    <>
      <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
        <textarea
          value={conteudo}
          onChange={(e) => setConteudo(e.target.value)}
          placeholder="Como foi seu dia? (opcional se você for gravar um áudio)"
          rows={4}
          className="resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
        />

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">Humor:</span>
          {([1, 2, 3, 4, 5] as const).map((nivel) => (
            <button
              key={nivel}
              type="button"
              onClick={() => setHumor(nivel)}
              aria-label={`Humor ${nivel}`}
              aria-pressed={humor === nivel}
              className={`rounded-lg px-2 py-1 text-lg transition-opacity ${
                humor === nivel ? "bg-background opacity-100" : "opacity-40 hover:opacity-70"
              }`}
            >
              {HUMOR_EMOJI[nivel]}
            </button>
          ))}
        </div>

        <RecorderControls recorder={recorder} />
        <HoldToRecordButton recorder={recorder} />

        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
          >
            {busy ? "Salvando…" : "Salvar entrada"}
          </button>
        </div>
      </section>

      <GeminiApiKeySettings
        currentKey={geminiApiKey}
        label={geminiApiKey ? "Chave da Gemini API configurada — trocar" : "Configurar transcrição (Gemini API)"}
        onSave={async (newKey) => {
          if (!key) return;
          const event: SettingsUpdatedEvent = { type: "settings_updated", geminiApiKey: newKey };
          await appendEvent(key, event);
          setGeminiApiKey(newKey);
        }}
      />

      <BiometricUnlockSettings />

      <div className="flex flex-col gap-3">
        {entries.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma entrada ainda.</p>
        ) : (
          entries.map((entry) => (
            <DiaryEntryCard
              key={entry.id}
              entry={entry}
              geminiApiKey={geminiApiKey}
              onTranscribed={async (texto) => {
                if (!key) return;
                await appendEvent(key, {
                  type: "diary_transcription_added",
                  entryId: entry.id,
                  texto,
                });
                await refresh();
              }}
            />
          ))
        )}
      </div>
    </>
  );
}

function RecorderControls({ recorder }: { recorder: AudioRecorder }) {
  if (recorder.hasPermission === false) {
    return (
      <div className="flex flex-col items-start gap-1">
        <button
          type="button"
          onClick={recorder.requestPermission}
          className="flex w-fit items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium"
        >
          🎙️ Permitir microfone
        </button>
        {recorder.error && <span className="text-sm text-red-400">{recorder.error}</span>}
      </div>
    );
  }

  if (recorder.error) {
    return (
      <p className="text-sm text-red-400">
        Não foi possível acessar o microfone: {recorder.error}
      </p>
    );
  }

  if (recorder.recording) {
    return (
      <span className="flex items-center gap-2 text-sm text-red-400">
        <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" />
        Gravando… {formatDuration(recorder.recordedSeconds)}
      </span>
    );
  }

  if (recorder.recordedBlob) {
    return (
      <div className="flex items-center gap-3">
        <audio controls src={recorder.recordedUrl ?? undefined} className="h-9 flex-1" />
        <span className="text-sm text-muted">{formatDuration(recorder.recordedSeconds)}</span>
        <button
          type="button"
          onClick={recorder.discard}
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium"
        >
          Descartar
        </button>
      </div>
    );
  }

  return (
    <p className="text-xs text-muted">
      🎙️ Segure o microfone no canto inferior direito para gravar — deslize para cima para travar.
    </p>
  );
}

const LOCK_THRESHOLD_PX = 80;
/** Soltar antes disso conta como toque acidental — descarta, como no WhatsApp. */
const MIN_HOLD_MS = 400;

/**
 * Botão flutuante estilo WhatsApp: segurar grava, soltar para; deslizar pra
 * cima até o cadeado trava a gravação (dá pra soltar o dedo), e aí o mesmo
 * botão vira "parar" e aparece a lixeira. Usa Pointer Events (toque e mouse)
 * com `setPointerCapture`, e `getUserMedia` sai direto do `pointerdown` — o
 * gesto conta como ativação do usuário (ver `lib/native/microphone.ts`).
 * Parar não salva a entrada: o áudio vai pra prévia do formulário, junto com
 * texto e humor, e só vira evento no "Salvar entrada".
 */
function HoldToRecordButton({ recorder }: { recorder: AudioRecorder }) {
  const [locked, setLocked] = useState(false);
  const [dragUp, setDragUp] = useState(0);
  const [hint, setHint] = useState(false);
  const holdingRef = useRef(false);
  const startYRef = useRef(0);
  const pressStartRef = useRef(0);

  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(false), 2000);
    return () => clearTimeout(t);
  }, [hint]);

  if (recorder.hasPermission === false || recorder.recordedBlob) return null;

  function finishHold() {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    setDragUp(0);
    if (Date.now() - pressStartRef.current < MIN_HOLD_MS) {
      recorder.cancel();
      setHint(true);
    } else {
      recorder.stop();
    }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    // Travado: o próximo toque no botão é o "parar" (não usa onClick — o
    // click do próprio gesto que travou dispararia o parar na hora).
    if (locked) {
      setLocked(false);
      recorder.stop();
      return;
    }
    if (recorder.recording) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    holdingRef.current = true;
    startYRef.current = e.clientY;
    pressStartRef.current = Date.now();
    setHint(false);
    void recorder.start();
  }

  function handlePointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    if (!holdingRef.current) return;
    const up = Math.max(0, startYRef.current - e.clientY);
    if (up >= LOCK_THRESHOLD_PX) {
      holdingRef.current = false;
      setDragUp(0);
      setLocked(true);
      return;
    }
    setDragUp(up);
  }

  const holding = recorder.recording && !locked;

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-20 flex items-end gap-3">
      {recorder.recording && (
        <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-surface px-4 py-2 text-sm shadow-lg">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" />
          <span className="tabular-nums text-foreground">{formatDuration(recorder.recordedSeconds)}</span>
          {locked ? (
            <button
              type="button"
              onClick={() => {
                setLocked(false);
                recorder.cancel();
              }}
              aria-label="Descartar gravação"
              className="text-muted hover:text-red-400"
            >
              🗑️
            </button>
          ) : (
            <span className="text-xs text-muted">↑ deslize para travar</span>
          )}
        </div>
      )}
      {hint && !recorder.recording && (
        <div className="rounded-full border border-border bg-surface px-4 py-2 text-xs text-muted shadow-lg">
          Segure para gravar
        </div>
      )}

      <div className="relative flex flex-col items-center">
        {holding && (
          <div
            className="absolute bottom-full mb-3 flex flex-col items-center gap-1 rounded-full border border-border bg-surface px-2 py-3 text-sm shadow-lg"
            style={{ transform: `translateY(${-dragUp}px)` }}
          >
            <span>🔒</span>
            <span className="text-xs text-muted">↑</span>
          </div>
        )}
        <button
          type="button"
          aria-label={locked ? "Parar gravação" : "Segure para gravar áudio"}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishHold}
          onPointerCancel={finishHold}
          onContextMenu={(e) => e.preventDefault()}
          className={`pointer-events-auto flex h-16 w-16 touch-none select-none items-center justify-center rounded-full text-2xl shadow-lg transition-transform ${
            recorder.recording ? "scale-110 bg-red-500 text-white" : "bg-accent text-background"
          }`}
        >
          {locked ? "■" : "🎙️"}
        </button>
      </div>
    </div>
  );
}

function DiaryEntryCard({
  entry,
  geminiApiKey,
  onTranscribed,
}: {
  entry: DiaryEntryItem;
  geminiApiKey: string | null;
  onTranscribed: (texto: string) => Promise<void>;
}) {
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);

  const audioUrl = useMemo(() => {
    if (!entry.audioBase64 || !entry.audioMimeType) return null;
    const blob = base64ToBlob(entry.audioBase64, entry.audioMimeType);
    return URL.createObjectURL(blob);
  }, [entry.audioBase64, entry.audioMimeType]);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  async function handleTranscribe() {
    if (!geminiApiKey || !entry.audioBase64 || !entry.audioMimeType) return;
    setTranscribing(true);
    setTranscribeError(null);
    try {
      const texto = await transcribeAudio(geminiApiKey, entry.audioBase64, entry.audioMimeType);
      await onTranscribed(texto);
    } catch (err) {
      setTranscribeError(err instanceof Error ? err.message : String(err));
    } finally {
      setTranscribing(false);
    }
  }

  return (
    <article className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2 text-sm text-muted">
        <span className="text-lg">{HUMOR_EMOJI[entry.humor]}</span>
        <span>{entry.horario}</span>
      </div>
      {entry.conteudo && <p className="whitespace-pre-wrap text-sm">{entry.conteudo}</p>}
      {audioUrl && (
        <div className="flex items-center gap-2">
          <audio controls src={audioUrl} className="h-9 flex-1" />
          {entry.audioDuracaoSeg !== null && (
            <span className="text-sm text-muted">{formatDuration(entry.audioDuracaoSeg)}</span>
          )}
        </div>
      )}
      {audioUrl && entry.transcricao === null && geminiApiKey && (
        <button
          type="button"
          onClick={handleTranscribe}
          disabled={transcribing}
          className="w-fit rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          {transcribing ? "Transcrevendo…" : "Transcrever"}
        </button>
      )}
      {transcribeError && <p className="text-sm text-red-400">Falha ao transcrever: {transcribeError}</p>}
      {entry.transcricao !== null && (
        <p className="whitespace-pre-wrap text-sm italic text-muted">&quot;{entry.transcricao}&quot;</p>
      )}
    </article>
  );
}
