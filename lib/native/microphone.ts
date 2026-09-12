/**
 * Wrapper do plugin nativo `MicrophonePlugin` (Android, ver
 * `android/app/src/main/java/com/thiago/diario/MicrophonePlugin.java`).
 * Fora do Android nativo (PWA desktop) tudo aqui é no-op — lá o próprio
 * navegador cuida do prompt de permissão dentro de `getUserMedia`.
 *
 * Importante: `requestMicrophonePermission` faz um `await` de uma operação
 * assíncrona que pode envolver um diálogo nativo do Android — chamá-la
 * imediatamente antes de `getUserMedia` quebra a "user activation" do
 * clique que originou a chamada, e o Chromium passa a rejeitar
 * `getUserMedia` com `NotAllowedError` mesmo com a permissão concedida.
 * Por isso o fluxo da página checa a permissão (sem pedir) ao montar, pede
 * (`requestMicrophonePermission`) só como uma etapa própria antes de
 * qualquer tentativa de gravar, e só chama `getUserMedia` a partir de um
 * clique novo, sem nenhum `await` de permissão no meio do caminho.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

interface MicrophonePluginInterface {
  checkMicrophonePermission(): Promise<{ granted: boolean }>;
  requestMicrophonePermission(): Promise<{ granted: boolean }>;
}

const Microphone = registerPlugin<MicrophonePluginInterface>("Microphone");

function isAndroid(): boolean {
  return Capacitor.getPlatform() === "android";
}

/** Lê o estado atual sem disparar nenhum diálogo. `true` fora do Android (nada a checar). */
export async function checkMicrophonePermission(): Promise<boolean> {
  if (!isAndroid()) return true;
  const { granted } = await Microphone.checkMicrophonePermission();
  return granted;
}

/** Pede a permissão nativamente (pode mostrar diálogo). `true` fora do Android. */
export async function ensureMicrophonePermission(): Promise<boolean> {
  if (!isAndroid()) return true;
  const { granted } = await Microphone.requestMicrophonePermission();
  return granted;
}
