"use client";

/**
 * Estado do cofre compartilhado entre páginas via Context — a chave derivada
 * fica só em memória (nunca em localStorage/IndexedDB) e sobrevive à
 * navegação entre rotas dentro da SPA. Um refresh completo do navegador
 * exige a senha de novo — isso é intencional (zero-knowledge).
 *
 * Exceção só de conveniência de DEV: em `NODE_ENV === "development"` o cofre
 * é desbloqueado automaticamente com uma senha de desenvolvimento (padrão
 * "123", sobrescrevível por `NEXT_PUBLIC_DEV_VAULT_PASSWORD`), para não pedir
 * senha a cada hot-reload. No build de produção (PWA/APK) esse caminho nunca
 * roda e a tela de senha continua obrigatória — o princípio E2EE do
 * CLAUDE.md permanece intacto.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { deriveMasterKeyBits, deriveSubkey } from "@/lib/crypto/keys";
import { checkAndRecordLoginAttempt, getOrCreateSalt } from "@/lib/db/auth-store";
import { listDecryptedEvents } from "@/lib/events/event-store";

const DEV_PASSWORD = process.env.NEXT_PUBLIC_DEV_VAULT_PASSWORD || "123";

type VaultStatus = "locked" | "unlocking" | "unlocked";

interface VaultContextValue {
  key: CryptoKey | null;
  status: VaultStatus;
  error: string | null;
  unlock: (password: string) => Promise<void>;
  lock: () => void;
}

const VaultContext = createContext<VaultContextValue | null>(null);

export function VaultProvider({ children }: { children: ReactNode }) {
  const [key, setKey] = useState<CryptoKey | null>(null);
  const [status, setStatus] = useState<VaultStatus>("locked");
  const [error, setError] = useState<string | null>(null);
  const autoUnlockTried = useRef(false);

  // Derivação da chave + decifra de verificação. Não aplica rate-limit —
  // isso é responsabilidade do `unlock` público (login humano).
  const deriveAndSet = useCallback(async (password: string) => {
    setStatus("unlocking");
    setError(null);
    try {
      const salt = await getOrCreateSalt();
      const masterBits = await deriveMasterKeyBits(password, salt);
      const encryptionKey = await deriveSubkey(masterBits, "event-encryption");
      // Sem verificador de senha separado: a decifra de um cofre existente
      // falha (AEAD) se a senha estiver errada. Cofre vazio = qualquer senha
      // define o cofre.
      await listDecryptedEvents(encryptionKey);
      setKey(encryptionKey);
      setStatus("unlocked");
    } catch {
      setError("Senha incorreta ou dados corrompidos — não foi possível decifrar o cofre.");
      setKey(null);
      setStatus("locked");
    }
  }, []);

  const unlock = useCallback(
    async (password: string) => {
      setStatus("unlocking");
      setError(null);
      const { allowed } = await checkAndRecordLoginAttempt();
      if (!allowed) {
        setError("Muitas tentativas de desbloqueio. Aguarde a janela de 15 minutos.");
        setStatus("locked");
        return;
      }
      await deriveAndSet(password);
    },
    [deriveAndSet],
  );

  const lock = useCallback(() => {
    setKey(null);
    setStatus("locked");
    setError(null);
  }, []);

  // Auto-desbloqueio só em dev, uma única vez por montagem. Se a senha de dev
  // estiver errada (cofre com outra senha), falha silenciosamente e cai na
  // tela de senha normal — sem loop. O setTimeout tira o setState do corpo
  // síncrono do efeito.
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (autoUnlockTried.current || key || status !== "locked") return;
    autoUnlockTried.current = true;
    const t = setTimeout(() => void deriveAndSet(DEV_PASSWORD), 0);
    return () => clearTimeout(t);
  }, [key, status, deriveAndSet]);

  return (
    <VaultContext.Provider value={{ key, status, error, unlock, lock }}>
      {children}
    </VaultContext.Provider>
  );
}

export function useVault(): VaultContextValue {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error("useVault precisa estar dentro de <VaultProvider>");
  return ctx;
}
