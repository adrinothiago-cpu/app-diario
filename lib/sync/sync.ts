/**
 * Sincronização do log de eventos com a `appDataFolder` do Google Drive.
 *
 * O log é append-only e cada evento tem id único (`evt_<ms>_<uuid>`), então
 * sincronizar é só união de conjuntos: envia o que falta no Drive, baixa o
 * que falta aqui. Nunca há conflito nem sobrescrita. Cada evento vira um
 * arquivo `<id>.enc` com o blob já cifrado (IV || ciphertext) — o Google
 * só vê bytes opacos.
 *
 * Cofre: o salt do PBKDF2 é gerado por aparelho, então o mesmo cofre em
 * dois aparelhos precisa do mesmo salt. O primeiro aparelho a sincronizar
 * publica o seu em `vault.json` (salt não é segredo). Um aparelho com salt
 * diferente é, por definição, **outra sessão/identidade** — nunca mescla:
 * pede a senha do cofre que já está no Drive, confere decifrando um evento
 * remoto, e então **arquiva** (não apaga) os eventos locais em quarentena —
 * saem da lista ativa e nunca são enviados ao Drive, mas continuam no
 * aparelho, cifrados com a chave antiga, sem reescrever nada. Decisão
 * deliberada (2026-09-29, achados do Thiago): misturar dado de uma sessão
 * com senha diferente no cofre de verdade é uma brecha, não uma
 * conveniência — mas apagar de vez também é arriscado (e se for dado real
 * que só ainda não foi identificado?), então o meio-termo é guardar cifrado
 * à parte, recuperável depois sem precisar reescrever. Evento baixado que
 * não decifra com a chave ativa também é descartado (um blob ruim
 * derrubaria o desbloqueio inteiro, que decifra tudo).
 */
import { decryptEvent } from "../crypto/cipher.ts";
import type { StoredEvent } from "../events/types.ts";
import type { DriveApi } from "./drive.ts";

export const VAULT_FILE = "vault.json";
const EVENT_SUFFIX = ".enc";
const CONCURRENCY = 4;

export interface LocalVaultStore {
  listEvents(): Promise<StoredEvent[]>;
  putEvent(event: StoredEvent): Promise<void>;
  setSalt(salt: Uint8Array): Promise<void>;
  /** Apaga o log ativo — só chamado depois de `quarantineEvents`, nunca sozinho. */
  clearEvents(): Promise<void>;
  /** Guarda uma cópia dos eventos (cifrados, sem decifrar nem tocar) fora do log ativo — recuperável depois, nunca lida nem enviada ao Drive automaticamente. */
  quarantineEvents(events: StoredEvent[]): Promise<void>;
}

export interface SyncParams {
  drive: DriveApi;
  store: LocalVaultStore;
  localKey: CryptoKey;
  localSalt: Uint8Array;
  deriveKey: (password: string, salt: Uint8Array) => Promise<CryptoKey>;
  /** Pede a senha do cofre que já está no Drive; `null` = usuário cancelou. */
  askRemotePassword: () => Promise<string | null>;
}

export interface SyncResult {
  enviados: number;
  recebidos: number;
  /** Eventos do Drive que não decifram com a chave ativa (ignorados). */
  invalidos: number;
  /** Chave nova quando este aparelho adotou o cofre do Drive — quem chama troca a da sessão. */
  novaChave: CryptoKey | null;
  /** Quantos eventos locais foram arquivados (guardados cifrados, fora da lista) por serem de uma sessão de senha diferente. */
  arquivados: number;
}

export class SyncCancelledError extends Error {}
export class RemotePasswordError extends Error {}

interface VaultFile {
  version: 1;
  salt: string;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Id do evento a partir do nome do arquivo `<id>.enc`; null pra qualquer outro arquivo. */
export function eventIdFromFileName(name: string): string | null {
  return name.startsWith("evt_") && name.endsWith(EVENT_SUFFIX) ? name.slice(0, -EVENT_SUFFIX.length) : null;
}

/** `evt_<ms>_<uuid>` → ms; o createdAt não viaja separado, está no próprio id. */
export function createdAtFromEventId(id: string): number {
  const ms = Number(id.split("_")[1]);
  return Number.isFinite(ms) ? ms : 0;
}

async function inBatches<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    await Promise.all(items.slice(i, i + CONCURRENCY).map(worker));
  }
}

export async function syncWithDrive(params: SyncParams): Promise<SyncResult> {
  const { drive, store, localKey, localSalt, deriveKey, askRemotePassword } = params;

  const files = await drive.listFiles();
  const remoteEvents = new Map<string, string>();
  for (const f of files) {
    const id = eventIdFromFileName(f.name);
    if (id) remoteEvents.set(id, f.id);
  }

  let activeKey = localKey;
  let novaChave: CryptoKey | null = null;
  let arquivados = 0;
  const vaultFile = files.find((f) => f.name === VAULT_FILE);

  if (!vaultFile) {
    const vault: VaultFile = { version: 1, salt: toBase64(localSalt) };
    await drive.upload(VAULT_FILE, JSON.stringify(vault), "application/json");
  } else {
    const raw = new TextDecoder().decode(await drive.download(vaultFile.id));
    const remoteSalt = fromBase64((JSON.parse(raw) as VaultFile).salt);

    if (!sameBytes(remoteSalt, localSalt)) {
      const password = await askRemotePassword();
      if (password === null) throw new SyncCancelledError("Sincronização cancelada.");
      const remoteKey = await deriveKey(password, remoteSalt);

      const amostra = remoteEvents.values().next();
      if (!amostra.done) {
        try {
          await decryptEvent(remoteKey, await drive.download(amostra.value));
        } catch {
          throw new RemotePasswordError("Senha incorreta para o cofre salvo no Google.");
        }
      }

      // Senha confere, mas é de outro salt: os eventos daqui são de uma
      // sessão diferente (não deste cofre) — nunca mescla. Arquiva em
      // quarentena (cifrados, como estão) antes de limpar o log ativo, pra
      // não perder nada mesmo que um dia precise recuperar.
      const locaisAntigos = await store.listEvents();
      if (locaisAntigos.length > 0) {
        await store.quarantineEvents(locaisAntigos);
        await store.clearEvents();
      }
      arquivados = locaisAntigos.length;
      await store.setSalt(remoteSalt);
      activeKey = remoteKey;
      novaChave = remoteKey;
    }
  }

  const locais = await store.listEvents();
  const localIds = new Set(locais.map((e) => e.id));

  const paraEnviar = locais.filter((e) => !remoteEvents.has(e.id));
  await inBatches(paraEnviar, (e) => drive.upload(`${e.id}${EVENT_SUFFIX}`, e.blob, "application/octet-stream"));

  const paraBaixar = [...remoteEvents].filter(([id]) => !localIds.has(id));
  let recebidos = 0;
  let invalidos = 0;
  await inBatches(paraBaixar, async ([id, fileId]) => {
    const blob = await drive.download(fileId);
    try {
      await decryptEvent(activeKey, blob);
    } catch {
      invalidos++;
      return;
    }
    await store.putEvent({ id, createdAt: createdAtFromEventId(id), blob });
    recebidos++;
  });

  return { enviados: paraEnviar.length, recebidos, invalidos, novaChave, arquivados };
}
