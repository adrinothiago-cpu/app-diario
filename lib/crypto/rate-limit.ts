/**
 * Lógica pura de rate-limit de login: máx. 5 tentativas por janela de 15
 * minutos. Separada da persistência (IndexedDB) para ser testável sem
 * depender de um ambiente de navegador.
 */

export const MAX_LOGIN_ATTEMPTS = 5;
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/** Remove tentativas fora da janela deslizante. */
export function pruneAttempts(attempts: number[], now: number): number[] {
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  return attempts.filter((timestamp) => timestamp > cutoff);
}

export function isRateLimited(attempts: number[], now: number): boolean {
  return pruneAttempts(attempts, now).length >= MAX_LOGIN_ATTEMPTS;
}

export function recordAttempt(attempts: number[], now: number): number[] {
  return [...pruneAttempts(attempts, now), now];
}
