import { describe, expect, it } from "vitest";
import {
  MAX_LOGIN_ATTEMPTS,
  RATE_LIMIT_WINDOW_MS,
  isRateLimited,
  recordAttempt,
} from "./rate-limit";

describe("rate-limit de login", () => {
  it("permite até 5 tentativas na janela", () => {
    const now = Date.now();
    let attempts: number[] = [];
    for (let i = 0; i < MAX_LOGIN_ATTEMPTS; i++) {
      expect(isRateLimited(attempts, now)).toBe(false);
      attempts = recordAttempt(attempts, now);
    }
    expect(isRateLimited(attempts, now)).toBe(true);
  });

  it("libera após a janela de 15 minutos expirar", () => {
    const now = Date.now();
    let attempts: number[] = [];
    for (let i = 0; i < MAX_LOGIN_ATTEMPTS; i++) attempts = recordAttempt(attempts, now);

    expect(isRateLimited(attempts, now)).toBe(true);
    expect(isRateLimited(attempts, now + RATE_LIMIT_WINDOW_MS + 1)).toBe(false);
  });
});
