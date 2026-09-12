/**
 * Wrapper do plugin nativo `MicrophonePlugin` (Android, ver
 * `android/app/src/main/java/com/thiago/diario/MicrophonePlugin.java`).
 * Fora do Android nativo (PWA desktop) é um no-op — lá o próprio navegador
 * cuida do prompt de permissão dentro de `getUserMedia`, sem precisar desse
 * passo extra.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

interface MicrophonePluginInterface {
  requestMicrophonePermission(): Promise<{ granted: boolean }>;
}

const Microphone = registerPlugin<MicrophonePluginInterface>("Microphone");

/** Resolve `true` se a permissão de microfone nativa está concedida (ou não se aplica, fora do Android). */
export async function ensureMicrophonePermission(): Promise<boolean> {
  if (Capacitor.getPlatform() !== "android") return true;
  const { granted } = await Microphone.requestMicrophonePermission();
  return granted;
}
