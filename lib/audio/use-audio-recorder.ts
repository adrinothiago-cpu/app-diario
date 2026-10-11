/**
 * Encapsula `MediaRecorder` + cronômetro, compartilhado pelo Diário e pelo
 * Treino. Interrompe as tracks do microfone assim que a gravação para (ou é
 * descartada) — não deixa o indicador de "microfone em uso" do sistema
 * aceso à toa.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { checkMicrophonePermission, ensureMicrophonePermission } from "@/lib/native/microphone";

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

export function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export type AudioRecorder = ReturnType<typeof useAudioRecorder>;

export function useAudioRecorder(options: { onRecorded?: (blob: Blob) => void } = {}) {
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
  // O dedo pode soltar o botão antes de `getUserMedia` resolver — aí o stop
  // fica pendente e é aplicado assim que a gravação de fato começa.
  const startingRef = useRef(false);
  const pendingStopRef = useRef(false);
  const discardOnStopRef = useRef(false);
  // `onstop` é criado no `start`; o ref garante que ele chame o callback da
  // renderização mais recente, não o capturado lá atrás.
  const onRecordedRef = useRef(options.onRecorded);
  useEffect(() => {
    onRecordedRef.current = options.onRecorded;
  });

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
    startingRef.current = true;
    pendingStopRef.current = false;
    discardOnStopRef.current = false;
    try {
      // Filtra os microfones para priorizar o microfone embutido (built-in) do aparelho
      // e evitar que pegue o microfone do fone Bluetooth mesmo com Bluetooth conectado
      let audioConstraints: MediaTrackConstraints | boolean = true;
      try {
        if (typeof navigator.mediaDevices?.enumerateDevices === "function") {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const audioInputs = devices.filter((d) => d.kind === "audioinput");
          // Procura microfones que NÃO sejam bluetooth/headset ou que sejam explicitamente built-in/internal/phone
          const builtIn = audioInputs.find((d) => {
            const label = d.label.toLowerCase();
            const isBt = label.includes("bluetooth") || label.includes("wireless") || label.includes("headset") || label.includes("earbuds") || label.includes("buds");
            const isInternal = label.includes("built-in") || label.includes("internal") || label.includes("phone") || label.includes("speaker") || label.includes("default");
            return !isBt && (isInternal || !label);
          });
          if (builtIn && builtIn.deviceId) {
            audioConstraints = { deviceId: { exact: builtIn.deviceId } };
          }
        }
      } catch {
        // fallback para audio: true caso enumerateDevices falhe
        audioConstraints = true;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      } catch {
        // Se a restrição exata falhar, tenta fallback seguro para microfone padrão
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      const mimeType = pickSupportedMimeType();
      // 32 kbps é ideal para voz humana (Opus/AAC): reduz em até ~70% o tamanho do payload e acelera o upload
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 32000,
      });
      chunksRef.current = [];
      setRecordedSeconds(0);

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mediaRecorder.onstop = () => {
        if (discardOnStopRef.current) {
          discardOnStopRef.current = false;
          setRecordedSeconds(0);
        } else {
          const blob = new Blob(chunksRef.current, { type: mimeType });
          setRecordedBlob(blob);
          onRecordedRef.current?.(blob);
        }
        stream.getTracks().forEach((track) => track.stop());
        if (intervalRef.current) clearInterval(intervalRef.current);
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setRecording(true);
      intervalRef.current = setInterval(() => setRecordedSeconds((s) => s + 1), 1000);
      startingRef.current = false;
      if (pendingStopRef.current) {
        pendingStopRef.current = false;
        stop();
      }
    } catch {
      startingRef.current = false;
      pendingStopRef.current = false;
      discardOnStopRef.current = false;
      setError("permissão negada ou nenhum microfone disponível.");
    }
  }

  function stop() {
    if (startingRef.current) {
      pendingStopRef.current = true;
      return;
    }
    const mediaRecorder = mediaRecorderRef.current;
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
  }

  /** Para sem guardar nada — toque rápido demais ou lixeira no modo travado. */
  function cancel() {
    discardOnStopRef.current = true;
    stop();
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
    cancel,
    discard,
  };
}
