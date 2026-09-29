import { describe, expect, it, vi } from "vitest";
import { decryptEvent, encryptEvent } from "@/lib/crypto/cipher";
import type { StoredEvent } from "@/lib/events/types";
import type { DriveApi, DriveFile } from "./drive";
import {
  RemotePasswordError,
  SyncCancelledError,
  VAULT_FILE,
  createdAtFromEventId,
  eventIdFromFileName,
  syncWithDrive,
  type LocalVaultStore,
} from "./sync";

// Chave determinística por (senha, salt) sem PBKDF2 de 600k iterações — o
// que se testa aqui é o algoritmo de sync, não a derivação.
async function fakeDerive(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = new TextEncoder().encode(`${password}|${Array.from(salt).join(",")}`);
  const hash = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function fakeDrive(initial: Record<string, ArrayBuffer | string> = {}) {
  const files = new Map<string, { name: string; body: ArrayBuffer }>();
  let n = 0;
  const add = (name: string, body: ArrayBuffer | string) => {
    const buf = typeof body === "string" ? new TextEncoder().encode(body).buffer : body;
    files.set(`f${n++}`, { name, body: buf as ArrayBuffer });
  };
  for (const [name, body] of Object.entries(initial)) add(name, body);
  const api: DriveApi = {
    listFiles: async () => [...files].map(([id, f]): DriveFile => ({ id, name: f.name })),
    download: async (id) => files.get(id)!.body,
    upload: vi.fn(async (name: string, body: ArrayBuffer | string) => add(name, body)),
  };
  return { api, names: () => [...files.values()].map((f) => f.name), files };
}

function fakeStore(events: StoredEvent[] = []) {
  const map = new Map(events.map((e) => [e.id, e]));
  const quarantine: StoredEvent[] = [];
  let salt: Uint8Array | null = null;
  const store: LocalVaultStore = {
    listEvents: async () => [...map.values()],
    putEvent: async (e) => void map.set(e.id, e),
    setSalt: async (s) => void (salt = s),
    clearEvents: async () => map.clear(),
    quarantineEvents: async (evs) => void quarantine.push(...evs),
  };
  return { store, map, quarantine, salt: () => salt };
}

async function makeEvent(key: CryptoKey, id: string, data: unknown): Promise<StoredEvent> {
  return { id, createdAt: createdAtFromEventId(id), blob: await encryptEvent(key, data) };
}

const SALT_CELULAR = new Uint8Array(16).fill(1);
const SALT_PC = new Uint8Array(16).fill(2);
const vaultJson = (salt: Uint8Array) => JSON.stringify({ version: 1, salt: btoa(String.fromCharCode(...salt)) });

describe("nomes de arquivo", () => {
  it("extrai o id do evento e o createdAt do próprio id", () => {
    expect(eventIdFromFileName("evt_1700000000000_abc.enc")).toBe("evt_1700000000000_abc");
    expect(eventIdFromFileName(VAULT_FILE)).toBeNull();
    expect(createdAtFromEventId("evt_1700000000000_abc")).toBe(1700000000000);
  });
});

describe("syncWithDrive", () => {
  it("primeiro aparelho: publica o vault.json e envia todos os eventos", async () => {
    const key = await fakeDerive("senha", SALT_CELULAR);
    const drive = fakeDrive();
    const { store } = fakeStore([await makeEvent(key, "evt_1_a", { x: 1 }), await makeEvent(key, "evt_2_b", { x: 2 })]);
    const ask = vi.fn();

    const r = await syncWithDrive({ drive: drive.api, store, localKey: key, localSalt: SALT_CELULAR, deriveKey: fakeDerive, askRemotePassword: ask });

    expect(ask).not.toHaveBeenCalled();
    expect(r).toMatchObject({ enviados: 2, recebidos: 0, novaChave: null });
    expect(drive.names().sort()).toEqual(["evt_1_a.enc", "evt_2_b.enc", VAULT_FILE].sort());
  });

  it("mesmo cofre: envia só o que falta lá e baixa só o que falta aqui", async () => {
    const key = await fakeDerive("senha", SALT_CELULAR);
    const remoto = await makeEvent(key, "evt_5_remoto", { de: "celular" });
    const drive = fakeDrive({ [VAULT_FILE]: vaultJson(SALT_CELULAR), "evt_5_remoto.enc": remoto.blob });
    const local = fakeStore([await makeEvent(key, "evt_6_local", { de: "pc" })]);

    const r = await syncWithDrive({ drive: drive.api, store: local.store, localKey: key, localSalt: SALT_CELULAR, deriveKey: fakeDerive, askRemotePassword: vi.fn() });

    expect(r).toMatchObject({ enviados: 1, recebidos: 1, invalidos: 0 });
    expect(local.map.get("evt_5_remoto")?.createdAt).toBe(5);
    expect(await decryptEvent(key, local.map.get("evt_5_remoto")!.blob)).toEqual({ de: "celular" });
  });

  it("cofre diferente: pede a senha do celular, ARQUIVA (não apaga) o que já existia aqui e adota o salt", async () => {
    const chaveCelular = await fakeDerive("senha-celular", SALT_CELULAR);
    const chavePc = await fakeDerive("123", SALT_PC);
    const drive = fakeDrive({
      [VAULT_FILE]: vaultJson(SALT_CELULAR),
      "evt_1_cel.enc": (await makeEvent(chaveCelular, "evt_1_cel", { de: "celular" })).blob,
    });
    const local = fakeStore([await makeEvent(chavePc, "evt_2_pc", { de: "pc" })]);

    const r = await syncWithDrive({
      drive: drive.api,
      store: local.store,
      localKey: chavePc,
      localSalt: SALT_PC,
      deriveKey: fakeDerive,
      askRemotePassword: async () => "senha-celular",
    });

    expect(r.novaChave).not.toBeNull();
    expect(local.salt()).toEqual(SALT_CELULAR);
    expect(r).toMatchObject({ enviados: 0, recebidos: 1, arquivados: 1 });
    // Saiu do log ativo — nunca mesclado nem enviado ao Drive.
    expect(local.map.has("evt_2_pc")).toBe(false);
    expect([...drive.files.values()].some((f) => f.name === "evt_2_pc.enc")).toBe(false);
    // Mas continua no aparelho, em quarentena, intacto (mesmo blob, decifra com a chave ANTIGA sem reescrever nada).
    expect(local.quarantine.map((e) => e.id)).toEqual(["evt_2_pc"]);
    expect(await decryptEvent(chavePc, local.quarantine[0].blob)).toEqual({ de: "pc" });
    // Só o evento do celular ficou no log ativo, decifrável com a chave do celular.
    expect(await decryptEvent(chaveCelular, local.map.get("evt_1_cel")!.blob)).toEqual({ de: "celular" });
  });

  it("cofre diferente com senha errada: falha sem tocar em nada local", async () => {
    const chaveCelular = await fakeDerive("senha-celular", SALT_CELULAR);
    const chavePc = await fakeDerive("123", SALT_PC);
    const drive = fakeDrive({
      [VAULT_FILE]: vaultJson(SALT_CELULAR),
      "evt_1_cel.enc": (await makeEvent(chaveCelular, "evt_1_cel", {})).blob,
    });
    const original = await makeEvent(chavePc, "evt_2_pc", { de: "pc" });
    const local = fakeStore([original]);

    await expect(
      syncWithDrive({ drive: drive.api, store: local.store, localKey: chavePc, localSalt: SALT_PC, deriveKey: fakeDerive, askRemotePassword: async () => "errada" }),
    ).rejects.toBeInstanceOf(RemotePasswordError);
    expect(local.map.get("evt_2_pc")).toBe(original);
    expect(local.salt()).toBeNull();
    expect(drive.api.upload).not.toHaveBeenCalled();
  });

  it("cofre diferente e usuário cancela a senha: não muda nada", async () => {
    const chavePc = await fakeDerive("123", SALT_PC);
    const drive = fakeDrive({ [VAULT_FILE]: vaultJson(SALT_CELULAR) });
    const local = fakeStore([await makeEvent(chavePc, "evt_2_pc", {})]);

    await expect(
      syncWithDrive({ drive: drive.api, store: local.store, localKey: chavePc, localSalt: SALT_PC, deriveKey: fakeDerive, askRemotePassword: async () => null }),
    ).rejects.toBeInstanceOf(SyncCancelledError);
    expect(local.salt()).toBeNull();
  });

  it("descarta evento do Drive que não decifra com a chave ativa", async () => {
    const key = await fakeDerive("senha", SALT_CELULAR);
    const outra = await fakeDerive("outra", SALT_CELULAR);
    const drive = fakeDrive({
      [VAULT_FILE]: vaultJson(SALT_CELULAR),
      "evt_1_bom.enc": (await makeEvent(key, "evt_1_bom", {})).blob,
      "evt_2_ruim.enc": (await makeEvent(outra, "evt_2_ruim", {})).blob,
    });
    const local = fakeStore();

    const r = await syncWithDrive({ drive: drive.api, store: local.store, localKey: key, localSalt: SALT_CELULAR, deriveKey: fakeDerive, askRemotePassword: vi.fn() });

    expect(r).toMatchObject({ recebidos: 1, invalidos: 1 });
    expect(local.map.has("evt_2_ruim")).toBe(false);
  });
});
