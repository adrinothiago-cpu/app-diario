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
import { VaultGate } from "@/components/vault-gate";
import { useVault } from "@/components/vault-provider";
import { arrayBufferToBase64, base64ToBlob } from "@/lib/audio/encoding";
import { appendEvent, listDecryptedEvents } from "@/lib/events/event-store";
import { reduceDiaryEntries } from "@/lib/events/diary-store";
import { reduceSettings } from "@/lib/events/settings-store";
import type { DiaryEntryEvent, DiaryEntryItem, SettingsUpdatedEvent } from "@/lib/events/types";
import { checkMicrophonePermission, ensureMicrophonePermission } from "@/lib/native/microphone";
import { transcribeAudio } from "@/lib/transcription/gemini";

const HUMOR_EMOJI: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "😞",
  2: "🙁",
  3: "😐",
  4: "🙂",
  5: "😄",
};

/** Primeiro tipo suportado pelo `MediaRecorder` do WebView/navegador atual. */
function pickSupportedMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  for (const candidate of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return "audio/webm";
}

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
  const { key } = useVault();
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
  }, [key]);

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

      <ApiKeySettings
        currentKey={geminiApiKey}
        onSave={async (newKey) => {
          if (!key) return;
          const event: SettingsUpdatedEvent = { type: "settings_updated", geminiApiKey: newKey };
          await appendEvent(key, event);
          setGeminiApiKey(newKey);
        }}
      />

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

function ApiKeySettings({
  currentKey,
  onSave,
}: {
  currentKey: string | null;
  onSave: (key: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-fit text-sm text-muted underline decoration-dotted underline-offset-4 hover:text-foreground"
      >
        {currentKey ? "Chave da Gemini API configurada — trocar" : "Configurar transcrição (Gemini API)"}
      </button>
    );
  }

  async function handleSave() {
    if (input.trim() === "") return;
    setSaving(true);
    try {
      await onSave(input.trim());
      setInput("");
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
      <p className="text-sm text-muted">
        A chave fica cifrada localmente (mesmo esquema do resto do cofre) e
        nunca sai do aparelho — só é usada para chamar a Gemini API quando
        você aperta &quot;Transcrever&quot; numa entrada. Gere a sua em{" "}
        <span className="select-all">aistudio.google.com/apikey</span>.
      </p>
      <input
        type="password"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={currentKey ? "Nova chave (substitui a atual)" : "Cole sua chave aqui"}
        className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || input.trim() === ""}
          className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          {saving ? "Salvando…" : "Salvar"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium"
        >
          Cancelar
        </button>
      </div>
    </section>
  );
}

function RecorderControls({ recorder }: { recorder: ReturnType<typeof useAudioRecorder> }) {
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
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-2 text-sm text-red-400">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" />
          Gravando… {formatDuration(recorder.recordedSeconds)}
        </span>
        <button
          type="button"
          onClick={recorder.stop}
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium"
        >
          Parar
        </button>
      </div>
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
    <button
      type="button"
      onClick={recorder.start}
      className="flex w-fit items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium"
    >
      🎙️ Gravar áudio
    </button>
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

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Encapsula `MediaRecorder` + cronômetro. Interrompe as tracks do microfone
 * assim que a gravação para (ou é descartada) — não deixa o indicador de
 * "microfone em uso" do sistema aceso à toa.
 */
function useAudioRecorder() {
  const [recording, setRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedSeconds, setRecordedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // "unknown" enquanto a checagem inicial não termina — trata como "sem
  // permissão ainda" para não piscar o botão de gravar antes de saber.
  const [hasPermission, setHasPermission] = useState<boolean | "unknown">("unknown");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    checkMicrophonePermission().then(setHasPermission);
  }, []);

  // Só pede a permissão nativa — nunca chama getUserMedia aqui. `await`
  // esperando um diálogo do sistema quebra a "user activation" do clique;
  // por isso este passo fica isolado do clique que efetivamente grava (ver
  // comentário em `lib/native/microphone.ts`).
  async function requestPermission() {
    setError(null);
    const granted = await ensureMicrophonePermission();
    setHasPermission(granted);
    if (!granted) setError("permissão de microfone negada.");
  }

  const recordedUrl = useMemo(() => {
    if (!recordedBlob) return null;
    return URL.createObjectURL(recordedBlob);
  }, [recordedBlob]);

  useEffect(() => {
    return () => {
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    };
  }, [recordedUrl]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  async function start() {
    setError(null);
    try {
      // getUserMedia precisa ser a primeira coisa chamada a partir do
      // clique, sem nenhum `await` de permissão antes — ver comentário em
      // `lib/native/microphone.ts`.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickSupportedMimeType();
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      setRecordedSeconds(0);

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mediaRecorder.onstop = () => {
        setRecordedBlob(new Blob(chunksRef.current, { type: mimeType }));
        stream.getTracks().forEach((track) => track.stop());
        if (intervalRef.current) clearInterval(intervalRef.current);
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setRecording(true);
      intervalRef.current = setInterval(() => setRecordedSeconds((s) => s + 1), 1000);
    } catch {
      setError("permissão negada ou nenhum microfone disponível.");
    }
  }

  function stop() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }

  function discard() {
    setRecordedBlob(null);
    setRecordedSeconds(0);
  }

  return {
    recording,
    recordedBlob,
    recordedUrl,
    recordedSeconds,
    error,
    hasPermission,
    requestPermission,
    start,
    stop,
    discard,
  };
}
