"use client";

import { useSync } from "@/components/sync-provider";
import { VaultUnlockForm } from "@/components/vault-gate";
import { useVault } from "@/components/vault-provider";

const hora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

export function SyncPanel() {
  const { key } = useVault();
  const { enabled, status, error, last, syncNow, disconnect } = useSync();

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
      <h2 className="font-medium">Sincronização (Google Drive)</h2>
      <p className="text-sm text-muted">
        Seus dados vão cifrados para uma pasta oculta do app no seu Google Drive — o Google só vê bytes
        embaralhados. Conecte a mesma conta Google em cada aparelho e use a mesma senha do cofre.
      </p>

      {!key ? (
        <>
          <p className="text-sm text-muted">Destrave o cofre para sincronizar.</p>
          <VaultUnlockForm />
        </>
      ) : (
        <>
          {status === "sincronizando" && <p className="animate-pulse text-sm text-accent">Sincronizando…</p>}
          {status === "ok" && last && (
            <p className="text-sm text-foreground">
              Sincronizado às {hora.format(last.at)} — {last.enviados} enviado(s), {last.recebidos} recebido(s)
              {last.invalidos > 0 && `, ${last.invalidos} ignorado(s) por não abrirem com esta senha`}
              {last.arquivados > 0 &&
                `. ${last.arquivados} evento(s) que só existiam aqui (senha diferente) saíram da lista, mas continuam guardados cifrados no aparelho`}
              .
            </p>
          )}
          {status === "precisa_login" && (
            <p className="text-sm text-amber-400">Conecte ao Google de novo para continuar sincronizando.</p>
          )}
          {status === "erro" && error && <p className="text-sm text-red-400">Falha: {error}</p>}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void syncNow()}
              disabled={status === "sincronizando"}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
            >
              {enabled ? "Sincronizar agora" : "Conectar ao Google e sincronizar"}
            </button>
            {enabled && (
              <button
                type="button"
                onClick={disconnect}
                className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted hover:text-foreground"
              >
                Desconectar
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
