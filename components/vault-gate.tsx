"use client";

/** Formulário de desbloqueio reutilizável: renderiza os filhos só com o cofre aberto. */
import { useState, type FormEvent, type ReactNode } from "react";
import { useVault } from "./vault-provider";

export function VaultUnlockForm() {
  const { status, error, unlock } = useVault();
  const [password, setPassword] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void unlock(password);
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-sm flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Senha do cofre
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-foreground outline-none focus:border-accent"
          autoComplete="current-password"
        />
      </label>
      <button
        type="submit"
        disabled={status === "unlocking" || password.length === 0}
        className="rounded-lg bg-accent px-4 py-2 font-medium text-background disabled:opacity-50"
      >
        {status === "unlocking" ? "Desbloqueando…" : "Desbloquear"}
      </button>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  );
}

export function VaultGate({ children }: { children: ReactNode }) {
  const { key } = useVault();
  if (key) return <>{children}</>;
  return <VaultUnlockForm />;
}
