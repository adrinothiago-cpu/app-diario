"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { DevTag } from "@/components/dev-tag";
import { VaultUnlockForm } from "@/components/vault-gate";
import { useVault } from "@/components/vault-provider";
import { PriceSearch } from "@/components/compras/price-search";
import { CheckIcon, PlusIcon, UndoIcon } from "@/components/todo-icons";
import { appendEvent, listDecryptedEvents } from "@/lib/events/event-store";
import { reducePurchases } from "@/lib/events/purchase-store";
import { reduceSettings } from "@/lib/events/settings-store";
import type { DecryptedEvent, PurchaseItem, PurchasePriceResult } from "@/lib/events/types";
import { buscapeInApp } from "@/lib/prices/buscape-in-app";
import { PriceSearchUnavailableError, searchPricesAllSources, type GeminiStatus } from "@/lib/prices/search";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export default function ComprasPage() {
  return (
    <>
      <DevTag id="app/compras/page.tsx#ComprasPage" />
      <ComprasGate />
    </>
  );
}

function ComprasGate() {
  const { key } = useVault();

  if (!key) {
    return (
      <main className="flex flex-1 flex-col gap-4 p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Compras</h1>
        <VaultUnlockForm />
      </main>
    );
  }

  return <ComprasApp />;
}

type BulkStatus = "idle" | "running" | "done";
/** Só os campos que a busca de preço realmente usa — permite chamar antes de recarregar o item recém-criado do log. */
type PriceSearchTarget = { id: string; nome: string; observacao: string | null };

function ComprasApp() {
  const { key, dataVersion } = useVault();
  const [events, setEvents] = useState<DecryptedEvent[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<BulkStatus>("idle");
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  // Estado por item: enquanto a busca daquele item está rodando (spinner inline na linha)
  // e o erro da última tentativa, se houver — ambos indexados por purchaseId.
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [searchErrors, setSearchErrors] = useState<Record<string, string>>({});
  // Status da Gemini na última busca que não conseguiu usá-la — mostrado no final
  // como aviso (com link pra configurar a chave), sem interromper os resultados.
  const [avisoGemini, setAvisoGemini] = useState<{ status: GeminiStatus; buscapeOk: boolean } | null>(null);

  useEffect(() => {
    if (!key) return;
    listDecryptedEvents(key).then(setEvents);
  }, [key, dataVersion]);

  async function reload() {
    if (!key) return;
    setEvents(await listDecryptedEvents(key));
  }

  const purchases = useMemo(() => reducePurchases(events), [events]);
  const geminiApiKey = useMemo(() => reduceSettings(events).geminiApiKey, [events]);

  const ativos = purchases.filter((p) => p.apagadoEm === null && !p.comprado);
  const comprados = purchases.filter((p) => p.apagadoEm === null && p.comprado);
  const lixeira = purchases.filter((p) => p.apagadoEm !== null);

  // Dispara a busca de menor preço para um item imediatamente — chamada tanto
  // ao marcar "Varrer" num item quanto pelo botão de varredura em lote.
  // Indica progresso/erro inline na própria linha do item (`runningIds`/`searchErrors`).
  // Falta de chave da Gemini não interrompe: o Buscapé segue sozinho e o aviso
  // aparece no final (`avisoGemini`). Erro na linha só quando nenhuma fonte respondeu.
  async function runSearchFor(target: PriceSearchTarget) {
    if (!key) return;
    setRunningIds((prev) => new Set(prev).add(target.id));
    setSearchErrors((prev) => {
      if (!(target.id in prev)) return prev;
      const next = { ...prev };
      delete next[target.id];
      return next;
    });
    try {
      const busca = await searchPricesAllSources({
        geminiApiKey,
        nome: target.nome,
        observacao: target.observacao,
        buscape: buscapeInApp,
      });
      if (busca.gemini.status !== "ok") setAvisoGemini({ status: busca.gemini.status, buscapeOk: true });
      await appendEvent(key, {
        type: "purchase_price_search_updated",
        purchaseId: target.id,
        resultados: busca.resultados,
        modeloUsado: busca.fontes.join(" + "),
      });
      await reload();
    } catch (e) {
      if (e instanceof PriceSearchUnavailableError) setAvisoGemini({ status: e.gemini.status, buscapeOk: false });
      setSearchErrors((prev) => ({
        ...prev,
        [target.id]: e instanceof Error ? e.message : "Falha ao buscar preços.",
      }));
    } finally {
      setRunningIds((prev) => {
        const next = new Set(prev);
        next.delete(target.id);
        return next;
      });
    }
  }

  async function createPurchase(
    nome: string,
    quantidade: number | null,
    observacao: string | null,
    incluirBusca: boolean,
  ) {
    if (!key) return;
    const purchaseId = crypto.randomUUID();
    await appendEvent(key, {
      type: "purchase_created",
      purchaseId,
      nome,
      quantidade,
      observacao,
      incluirBusca,
    });
    await reload();
    if (incluirBusca) {
      await runSearchFor({ id: purchaseId, nome, observacao });
    }
  }

  async function toggleIncluirBusca(purchase: PurchaseItem) {
    if (!key) return;
    const next = !purchase.incluirBusca;
    await appendEvent(key, {
      type: "purchase_updated",
      purchaseId: purchase.id,
      incluirBusca: next,
    });
    await reload();
    if (next) {
      await runSearchFor(purchase);
    }
  }

  async function toggle(purchase: PurchaseItem) {
    if (!key) return;
    await appendEvent(key, { type: "purchase_toggled", purchaseId: purchase.id, comprado: !purchase.comprado });
    await reload();
  }

  async function softDelete(purchase: PurchaseItem) {
    if (!key) return;
    await appendEvent(key, { type: "purchase_deleted", purchaseId: purchase.id });
    await reload();
  }

  async function restore(purchase: PurchaseItem) {
    if (!key) return;
    await appendEvent(key, { type: "purchase_restored", purchaseId: purchase.id });
    await reload();
  }

  async function savePriceSearch(
    purchase: PurchaseItem,
    resultados: PurchasePriceResult[],
    modeloUsado: string,
  ) {
    if (!key) return;
    await appendEvent(key, {
      type: "purchase_price_search_updated",
      purchaseId: purchase.id,
      resultados,
      modeloUsado,
    });
    await reload();
  }

  // Reexecuta a busca para todos os itens já marcados (útil pra atualizar
  // preços depois de um tempo, sem precisar desmarcar/marcar cada um de novo).
  // Varre só os marcados — nunca todos — pelo mesmo motivo de sempre: cada
  // busca é uma chamada real à Gemini API (custo e rede). Sequencial de
  // propósito: reusa runSearchFor, que já recarrega o log a cada item —
  // rodar em paralelo faria os reloads concorrentes competirem entre si.
  async function runBulkPriceSearch() {
    const alvos = ativos.filter((p) => p.incluirBusca);
    if (alvos.length === 0) return;

    setBulkStatus("running");
    setAvisoGemini(null);
    setBulkProgress({ done: 0, total: alvos.length });

    for (const p of alvos) {
      await runSearchFor(p);
      setBulkProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev));
    }

    setBulkStatus("done");
  }

  const marcados = ativos.filter((p) => p.incluirBusca);

  return (
    <main className="mx-auto flex h-[calc(100dvh-56px)] w-full max-w-2xl flex-col gap-2 overflow-y-auto p-6">
      <header className="mb-2 flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Compras</h1>
        <div className="flex items-center gap-3">
          {marcados.length > 0 && (
            <button
              type="button"
              onClick={() => void runBulkPriceSearch()}
              disabled={bulkStatus === "running"}
              title="Marcar “Varrer” já busca na hora — use este botão pra atualizar de novo mais tarde"
              className="whitespace-nowrap rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50"
            >
              {bulkStatus === "running"
                ? `Atualizando ${bulkProgress?.done ?? 0}/${bulkProgress?.total ?? marcados.length}…`
                : `Atualizar preços (${marcados.length} marcados)`}
            </button>
          )}
          {lixeira.length > 0 && (
            <button
              type="button"
              onClick={() => setShowTrash((v) => !v)}
              className="whitespace-nowrap text-xs text-muted hover:text-foreground"
            >
              {showTrash ? "Ocultar lixeira" : `Lixeira (${lixeira.length})`}
            </button>
          )}
        </div>
      </header>

      {bulkStatus === "done" && <p className="text-xs text-muted">Atualização concluída.</p>}
      {avisoGemini && bulkStatus !== "running" && (
        <GeminiNotice status={avisoGemini.status} buscapeOk={avisoGemini.buscapeOk} />
      )}

      {!showTrash && (
        <>
          <AddPurchaseBar onCreate={createPurchase} />

          {ativos.length === 0 && comprados.length === 0 && (
            <p className="px-2 py-8 text-center text-sm text-muted">Nenhum item de compra por aqui.</p>
          )}

          <ul className="flex flex-col">
            {ativos.map((p) => (
              <PurchaseRow
                key={p.id}
                purchase={p}
                geminiApiKey={geminiApiKey}
                buscando={runningIds.has(p.id)}
                erroBusca={searchErrors[p.id] ?? null}
                onToggle={() => toggle(p)}
                onDelete={() => softDelete(p)}
                onToggleIncluirBusca={() => toggleIncluirBusca(p)}
                onSavePriceSearch={(resultados, modeloUsado) => savePriceSearch(p, resultados, modeloUsado)}
              />
            ))}
          </ul>

          {comprados.length > 0 && (
            <section className="mt-2 flex flex-col">
              <h2 className="px-2 py-2 text-sm font-semibold text-muted">Comprados ({comprados.length})</h2>
              <ul className="flex flex-col">
                {comprados.map((p) => (
                  <PurchaseRow
                    key={p.id}
                    purchase={p}
                    geminiApiKey={geminiApiKey}
                    buscando={runningIds.has(p.id)}
                    erroBusca={searchErrors[p.id] ?? null}
                    onToggle={() => toggle(p)}
                    onDelete={() => softDelete(p)}
                    onToggleIncluirBusca={() => toggleIncluirBusca(p)}
                    onSavePriceSearch={(resultados, modeloUsado) => savePriceSearch(p, resultados, modeloUsado)}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {showTrash && (
        <ul className="flex flex-col">
          {lixeira.map((p) => (
            <li key={p.id} className="group flex items-center gap-3 border-b border-border/50 px-2 py-2.5">
              <span className="flex-1 truncate text-sm text-muted line-through" title={p.nome}>
                {p.nome}
              </span>
              <button
                type="button"
                onClick={() => restore(p)}
                className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-accent hover:bg-background"
              >
                <UndoIcon />
                Restaurar
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function GeminiNotice({ status, buscapeOk }: { status: GeminiStatus; buscapeOk: boolean }) {
  const motivo =
    status === "sem_chave"
      ? "Sem chave da Gemini API"
      : status === "chave_invalida"
        ? "Chave da Gemini API inválida"
        : "A Gemini falhou nesta busca";
  return (
    <p className="text-xs text-amber-400">
      Aviso: {motivo}
      {buscapeOk ? " — resultados só do Buscapé." : "."}{" "}
      {status !== "erro" && (
        <Link href="/diario" className="underline">
          Configurar a chave no Diário
        </Link>
      )}
    </p>
  );
}

function AddPurchaseBar({
  onCreate,
}: {
  onCreate: (
    nome: string,
    quantidade: number | null,
    observacao: string | null,
    incluirBusca: boolean,
  ) => Promise<void>;
}) {
  const [nome, setNome] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [observacao, setObservacao] = useState("");
  const [incluirBusca, setIncluirBusca] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (nome.trim().length === 0) return;
    const qtd = quantidade.trim() === "" ? null : Number(quantidade);
    onCreate(
      nome.trim(),
      qtd !== null && Number.isFinite(qtd) ? qtd : null,
      observacao.trim() || null,
      incluirBusca,
    );
    setNome("");
    setQuantidade("");
    setObservacao("");
    setIncluirBusca(false);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap items-center gap-3 rounded-xl bg-surface px-3 py-2.5 ring-1 ring-transparent transition-shadow focus-within:ring-border"
    >
      <span className="text-muted">
        <PlusIcon />
      </span>
      <input
        type="text"
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        placeholder="Adicionar item de compra"
        className="min-w-[10rem] flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
      />
      <input
        type="text"
        value={observacao}
        onChange={(e) => setObservacao(e.target.value)}
        placeholder="marca/modelo (opcional, ajuda a busca)"
        className="min-w-[10rem] flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
      />
      <input
        type="number"
        min={1}
        value={quantidade}
        onChange={(e) => setQuantidade(e.target.value)}
        placeholder="qtd"
        className="w-14 shrink-0 bg-transparent text-sm outline-none placeholder:text-muted"
      />
      <label
        className="flex shrink-0 items-center gap-1.5 text-xs text-muted"
        title="Incluir este item na varredura em lote do menor preço"
      >
        <input
          type="checkbox"
          checked={incluirBusca}
          onChange={(e) => setIncluirBusca(e.target.checked)}
        />
        Varrer preço
      </label>
      {nome.trim().length > 0 && (
        <button
          type="submit"
          className="shrink-0 rounded-lg bg-accent px-3 py-1 text-xs font-medium text-background"
        >
          Adicionar
        </button>
      )}
    </form>
  );
}

function PurchaseRow({
  purchase,
  geminiApiKey,
  buscando,
  erroBusca,
  onToggle,
  onDelete,
  onToggleIncluirBusca,
  onSavePriceSearch,
}: {
  purchase: PurchaseItem;
  geminiApiKey: string | null;
  buscando: boolean;
  erroBusca: string | null;
  onToggle: () => void;
  onDelete: () => void;
  onToggleIncluirBusca: () => void;
  onSavePriceSearch: (resultados: PurchasePriceResult[], modeloUsado: string) => Promise<void>;
}) {
  return (
    <li className="group flex items-start gap-3 border-b border-border/50 px-2 py-2.5 hover:bg-background/60">
      <button
        type="button"
        onClick={onToggle}
        aria-label={purchase.comprado ? "Desmarcar como comprado" : "Marcar como comprado"}
        className="mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-2 transition-colors"
        style={{
          borderColor: purchase.comprado ? "#58617a" : "var(--color-muted)",
          backgroundColor: purchase.comprado ? "#58617a" : "transparent",
        }}
      >
        {purchase.comprado ? (
          <CheckIcon />
        ) : (
          <span className="opacity-0 transition-opacity group-hover:opacity-100">
            <CheckIcon color="var(--color-muted)" />
          </span>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`truncate text-sm ${purchase.comprado ? "text-muted line-through" : "text-foreground"}`}
            title={purchase.nome}
          >
            {purchase.nome}
          </span>
          {purchase.quantidade !== null && (
            <span className="shrink-0 text-xs text-muted">×{purchase.quantidade}</span>
          )}
        </div>
        {buscando && (
          <p className="mt-0.5 animate-pulse text-xs text-accent">Buscando menor preço na internet…</p>
        )}
        {!buscando && erroBusca && (
          <p className="mt-0.5 truncate text-xs text-red-400" title={erroBusca}>
            Falha na busca: {erroBusca}
          </p>
        )}
        {!buscando && !erroBusca && purchase.precos.length > 0 && (
          <ul className="mt-1.5 flex flex-col gap-1">
            {purchase.precos.map((r, i) => (
              <li key={`${i}-${r.url}`} className="flex items-center gap-2 text-xs">
                <span className={`w-20 shrink-0 font-medium ${i === 0 ? "text-accent" : "text-foreground"}`}>
                  {currency.format(r.preco)}
                </span>
                <span className="min-w-0 truncate" title={r.nome ? `${r.nome} — ${r.loja}` : r.loja}>
                  <span className="text-muted">
                    {r.loja}
                    {i === 0 && " · menor preço"}
                  </span>
                  {r.nome && <span className="text-foreground/70"> · {r.nome}</span>}
                </span>
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Abre a página do produto na loja"
                  className="ml-auto shrink-0 text-accent hover:underline"
                >
                  ver na loja ↗
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <label
        className="flex shrink-0 items-center gap-1.5 text-xs text-muted"
        title="Incluir este item na varredura em lote do menor preço"
      >
        <input
          type="checkbox"
          checked={purchase.incluirBusca}
          disabled={buscando}
          onChange={onToggleIncluirBusca}
        />
        Varrer
      </label>

      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100">
        <PriceSearch geminiApiKey={geminiApiKey} purchase={purchase} onSave={onSavePriceSearch} />
        <button
          type="button"
          onClick={onDelete}
          title="Excluir"
          className="rounded px-1 text-muted hover:text-red-400"
        >
          ✕
        </button>
      </div>
    </li>
  );
}
