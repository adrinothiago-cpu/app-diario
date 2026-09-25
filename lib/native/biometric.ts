/**
 * Wrapper do plugin nativo `BiometricVault` (Android, ver
 * `android/app/src/main/java/com/thiago/diario/BiometricPlugin.java`).
 * Fora do Android nativo (PWA desktop) tudo aqui resolve para "indisponível"
 * — o desbloqueio por digital não existe fora do app instalado.
 *
 * A senha do cofre só sai deste módulo em texto puro como retorno de
 * `unlockWithBiometricSecret()`, imediatamente após um `BiometricPrompt`
 * bem-sucedido, para ser usada uma vez pelo fluxo normal de `unlock()` do
 * `VaultProvider` — nunca fica guardada em variável de módulo.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

interface BiometricVaultPluginInterface {
  isAvailable(): Promise<{ available: boolean }>;
  hasEnrolledSecret(): Promise<{ enrolled: boolean }>;
  enroll(options: { secret: string }): Promise<{ ok: boolean }>;
  unlock(): Promise<{ secret: string }>;
  disable(): Promise<void>;
}

const BiometricVault = registerPlugin<BiometricVaultPluginInterface>("BiometricVault");

function isAndroid(): boolean {
  return Capacitor.getPlatform() === "android";
}

/** `true` se o aparelho tem hardware biométrico configurado (digital/face). */
export async function isBiometricAvailable(): Promise<boolean> {
  if (!isAndroid()) return false;
  const { available } = await BiometricVault.isAvailable();
  return available;
}

/** `true` se o usuário já ativou o desbloqueio por digital neste aparelho. */
export async function hasBiometricEnrolled(): Promise<boolean> {
  if (!isAndroid()) return false;
  const { enrolled } = await BiometricVault.hasEnrolledSecret();
  return enrolled;
}

/** Cifra `password` atrás da chave biométrica do Keystore, pedindo confirmação de digital. */
export async function enrollBiometricUnlock(password: string): Promise<void> {
  if (!isAndroid()) throw new Error("Desbloqueio por digital só é suportado no Android nativo.");
  await BiometricVault.enroll({ secret: password });
}

/** Pede a digital e devolve a senha do cofre já decifrada, para uso imediato. */
export async function unlockWithBiometricSecret(): Promise<string> {
  if (!isAndroid()) throw new Error("Desbloqueio por digital só é suportado no Android nativo.");
  const { secret } = await BiometricVault.unlock();
  return secret;
}

/** Apaga o segredo cifrado e a chave do Keystore — volta a exigir só a senha. */
export async function disableBiometricUnlock(): Promise<void> {
  if (!isAndroid()) return;
  await BiometricVault.disable();
}

/**
 * Erros rejeitados pelo `BiometricPlugin` chegam como `{ message, code }`
 * (Capacitor propaga o segundo argumento de `PluginCall.reject` como `code`).
 * `code` inclui valores fixos (`"USER_CANCELED"`, `"KEY_INVALIDATED"`, etc.)
 * e variantes dinâmicas (`"BIOMETRIC_ERROR_<n>"`), por isso fica como `string`.
 */
export interface BiometricPluginError {
  message?: string;
  code?: string;
}

export function isBiometricPluginError(err: unknown): err is BiometricPluginError {
  return typeof err === "object" && err !== null;
}
