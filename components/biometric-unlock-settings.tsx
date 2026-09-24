"use client";

import { useState } from "react";
import { useVault } from "@/components/vault-provider";

/**
 * Ativa/desativa o desbloqueio por digital neste aparelho (Android). Some
 * silenciosamente se o hardware não suportar — não faz sentido oferecer a
 * opção fora do Android nativo ou num aparelho sem biometria configurada.
 */
export function BiometricUnlockSettings() {
  const { biometricAvailable, biometricEnrolled, enrollBiometric, disableBiometric } = useVault();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!biometricAvailable) return null;

  if (biometricEnrolled) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <span>Desbloqueio por digital: ativado</span>
        <button
          type="button"
          onClick={() => void disableBiometric()}
          className="text-sm text-muted underline decoration-dotted underline-offset-4 hover:text-foreground"
        >
          Desativar
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-fit text-sm text-muted underline decoration-dotted underline-offset-4 hover:text-foreground"
      >
        Ativar desbloqueio por digital
      </button>
    );
  }

  async function handleEnable() {
    if (password === "") return;
    setSaving(true);
    setError(null);
    try {
      await enrollBiometric(password);
      setPassword("");
      setOpen(false);
    } catch {
      setError("Não foi possível ativar — confirme a senha e tente de novo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
      <p className="text-sm text-muted">
        Confirme a senha atual do cofre para cifrar o acesso por digital. A
        senha fica protegida pelo hardware seguro do aparelho (Android
        Keystore) e só é liberada depois de uma autenticação biométrica —
        nunca fica em texto puro no disco.
      </p>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Senha do cofre"
        autoComplete="current-password"
        className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleEnable}
          disabled={saving || password === ""}
          className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          {saving ? "Ativando…" : "Ativar"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setPassword("");
            setError(null);
          }}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium"
        >
          Cancelar
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </section>
  );
}
