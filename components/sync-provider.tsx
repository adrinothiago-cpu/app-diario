"use client";

/**
 * Sincronização automática com o Google Drive (`lib/sync/sync.ts`). Depois
 * que o usuário conecta a conta uma vez neste aparelho, roda sozinha:
 * ao destravar o cofre, alguns segundos depois de cada evento novo e ao
 * voltar pro app. Quando o Drive já tem o cofre de outro aparelho com outro
 * salt, abre um diálogo pedindo a senha daquele cofre.
 *
 * "Conectado" é só uma preferência deste aparelho em localStorage (nenhum
 * token fica salvo): no Android o token volta sem tela nenhuma; no PC ele
 * vive só em memória, então depois de recarregar a página é preciso clicar
 * em sincronizar de novo.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useVault } from "@/components/vault-provider";
import { deriveEventKey } from "@/lib/crypto/keys";
import { getOrCreateSalt, setSalt } from "@/lib/db/auth-store";
import { getAllRecords, putRecord } from "@/lib/db/indexeddb";
import { EVENT_APPENDED } from "@/lib/events/event-store";
import type { StoredEvent } from "@/lib/events/types";
import { createDriveApi, DriveAuthError } from "@/lib/sync/drive";
import { forgetDriveToken, getDriveAccessToken, NeedsInteractionError } from "@/lib/sync/google-auth";
import { SyncCancelledError, syncWithDrive, type SyncResult } from "@/lib/sync/sync";

const ENABLED_KEY = "diario:drive-sync-enabled";
const DEBOUNCE_MS = 5_000;

export type SyncStatus = "desconectado" | "sincronizando" | "ok" | "precisa_login" | "erro";

interface SyncContextValue {
  enabled: boolean;
  status: SyncStatus;
  error: string | null;
  last: (SyncResult & { at: number }) | null;
  /** Clique do usuário: faz login se preciso e sincroniza. */
  syncNow: () => Promise<void>;
  disconnect: () => void;
}

const SyncContext = createContext<SyncContextValue | null>(null);

function readEnabled(): boolean {
  try {
    return window.localStorage.getItem(ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeEnabled(value: boolean): void {
  try {
    if (value) window.localStorage.setItem(ENABLED_KEY, "1");
    else window.localStorage.removeItem(ENABLED_KEY);
  } catch {
    // sem storage (aba privada etc.) — só não lembra a preferência
  }
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const { key, adoptKey, bumpDataVersion } = useVault();
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<SyncStatus>("desconectado");
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<SyncContextValue["last"]>(null);
  const [passwordPrompt, setPasswordPrompt] = useState<((password: string | null) => void) | null>(null);

  const keyRef = useRef(key);
  const running = useRef(false);
  const rerun = useRef(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Re-execução pedida durante uma sync em andamento — por ref pra `run` não se referenciar.
  const runRef = useRef<(interactive: boolean) => Promise<void>>(async () => {});

  useEffect(() => {
    keyRef.current = key;
  }, [key]);

  useEffect(() => {
    const t = setTimeout(() => setEnabled(readEnabled()), 0);
    return () => clearTimeout(t);
  }, []);

  const run = useCallback(
    async (interactive: boolean) => {
      const localKey = keyRef.current;
      if (!localKey) return;
      if (running.current) {
        rerun.current = true;
        return;
      }
      running.current = true;
      setStatus("sincronizando");
      setError(null);
      try {
        const token = await getDriveAccessToken({ interactive });
        const result = await syncWithDrive({
          drive: createDriveApi(token),
          store: {
            listEvents: () => getAllRecords<StoredEvent>("events"),
            putEvent: (ev) => putRecord("events", ev),
            setSalt,
          },
          localKey,
          localSalt: await getOrCreateSalt(),
          deriveKey: deriveEventKey,
          askRemotePassword: () => new Promise((resolve) => setPasswordPrompt(() => resolve)),
        });
        if (result.novaChave) {
          keyRef.current = result.novaChave;
          adoptKey(result.novaChave);
        }
        if (result.recebidos > 0 || result.novaChave) bumpDataVersion();
        setLast({ ...result, at: Date.now() });
        setStatus("ok");
      } catch (err) {
        if (err instanceof DriveAuthError) forgetDriveToken();
        if (err instanceof NeedsInteractionError || (err instanceof DriveAuthError && !interactive)) {
          setStatus("precisa_login");
        } else if (err instanceof SyncCancelledError) {
          setStatus("desconectado");
        } else {
          setStatus("erro");
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        running.current = false;
        setPasswordPrompt(null);
        if (rerun.current) {
          rerun.current = false;
          setTimeout(() => void runRef.current(false), 0);
        }
      }
    },
    [adoptKey, bumpDataVersion],
  );

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  const syncNow = useCallback(async () => {
    writeEnabled(true);
    setEnabled(true);
    await run(true);
  }, [run]);

  const disconnect = useCallback(() => {
    writeEnabled(false);
    setEnabled(false);
    forgetDriveToken();
    setStatus("desconectado");
  }, []);

  // Ao destravar o cofre — só na transição travado → destravado. Não depende
  // de `enabled`: o clique em "Conectar" já sincroniza, e uma segunda sync
  // disparada por aqui sobrescrevia o erro real do clique.
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);
  const destravado = key !== null;
  useEffect(() => {
    if (!destravado || !enabledRef.current) return;
    const t = setTimeout(() => void runRef.current(false), 0);
    return () => clearTimeout(t);
  }, [destravado]);

  // Evento novo gravado em qualquer tela, e ao voltar pro app.
  useEffect(() => {
    if (!enabled) return;
    const onAppended = () => {
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => void run(false), DEBOUNCE_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void run(false);
    };
    window.addEventListener(EVENT_APPENDED, onAppended);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(EVENT_APPENDED, onAppended);
      document.removeEventListener("visibilitychange", onVisible);
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [enabled, run]);

  return (
    <SyncContext.Provider value={{ enabled, status, error, last, syncNow, disconnect }}>
      {children}
      {passwordPrompt && (
        <RemotePasswordDialog
          onSubmit={(password) => passwordPrompt(password)}
          onCancel={() => passwordPrompt(null)}
        />
      )}
    </SyncContext.Provider>
  );
}

function RemotePasswordDialog({
  onSubmit,
  onCancel,
}: {
  onSubmit: (password: string) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!password) return;
    setSent(true);
    onSubmit(password);
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-3 rounded-xl bg-surface p-4">
        <h2 className="text-base font-semibold">Dados do outro aparelho encontrados</h2>
        <p className="text-sm text-muted">
          O Google já tem o cofre do seu outro aparelho (ex.: celular). Digite a senha daquele cofre para trazer os
          dados para cá. O que já existe neste aparelho é mantido e passa a usar a mesma senha.
        </p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Senha do cofre do celular"
          autoComplete="current-password"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-border px-3 py-1.5 text-sm">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!password || sent}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50"
          >
            {sent ? "Conferindo…" : "Trazer dados"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync precisa estar dentro de <SyncProvider>");
  return ctx;
}
