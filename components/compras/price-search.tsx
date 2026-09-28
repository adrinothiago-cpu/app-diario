"use client";

/**
 * Botão + modal por item de compra: pede à Gemini API (com grounding de
 * busca do Google) para pesquisar o menor preço atual do produto em lojas
 * online. Nada é pesquisado até o usuário confirmar explicitamente dentro do
 * modal — abrir o modal sozinho não dispara nenhuma chamada de rede. Mesmo
 * padrão de confirmação explícita usado em
 * `components/tarefas/diary-task-suggestions.tsx`.
 */
import Link from "next/link";
import { useState } from "react";
import { SparkleIcon } from "@/components/todo-icons";
import type { PurchaseItem, PurchasePriceResult } from "@/lib/events/types";
import { buscapeInApp } from "@/lib/prices/buscape-in-app";
import { searchPricesAllSources, type GeminiStatus } from "@/lib/prices/search";

export interface PriceSearchProps {
  geminiApiKey: string | null;
  purchase: PurchaseItem;
  onSave: (resultados: PurchasePriceResult[], modeloUsado: string) => Promise<void>;
}

type Status = "idle" | "loading" | "done" | "error" | "saved";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function PriceSearch({ geminiApiKey, purchase, onSave }: PriceSearchProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [resultados, setResultados] = useState<PurchasePriceResult[]>([]);
  const [geminiStatus, setGeminiStatus] = useState<GeminiStatus | null>(null);

  function openModal() {
    setOpen(true);
    setStatus("idle");
    setError(null);
    setResultados([]);
    setGeminiStatus(null);
  }

  function closeModal() {
    setOpen(false);
  }

  async function handleSearch() {
    setStatus("loading");
    setError(null);
    try {
      const busca = await searchPricesAllSources({
        geminiApiKey,
        nome: purchase.nome,
        observacao: purchase.observacao,
        buscape: buscapeInApp,
      });
      setGeminiStatus(busca.gemini.status);
      setResultados(busca.resultados);
      await onSave(busca.resultados, busca.fontes.join(" + "));
      setStatus(busca.resultados.length > 0 ? "done" : "saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao buscar preços.");
      setStatus("error");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        title="Buscar menor preço com IA"
        className="rounded p-1.5 text-muted hover:bg-surface hover:text-foreground"
      >
        <SparkleIcon />
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="flex max-h-[80vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-xl bg-surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Menor preço: {purchase.nome}</h2>
              <button type="button" onClick={closeModal} className="text-muted hover:text-foreground">
                ✕
              </button>
            </div>

            {status === "idle" && (
              <>
                <p className="text-sm text-muted">
                  Ao buscar, o nome do produto é consultado no Buscapé (agregador de preços, sem chave)
                  e, se houver chave configurada no Diário, também na Gemini API (pesquisa no Google).
                  O menor preço encontrado fica salvo neste item.
                </p>
                <button
                  type="button"
                  onClick={() => void handleSearch()}
                  className="w-fit rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-background"
                >
                  Buscar menor preço agora
                </button>
              </>
            )}

            {status === "loading" && (
              <p className="text-sm text-muted">Pesquisando na internet o menor preço…</p>
            )}

            {status === "error" && (
              <p className="text-sm text-red-400">
                {error}
                {!geminiApiKey && (
                  <>
                    {" "}
                    <Link href="/diario" className="underline">
                      Configurar no Diário
                    </Link>
                  </>
                )}
              </p>
            )}

            {status === "saved" && (
              <p className="text-sm text-muted">
                Nenhum preço confiável encontrado para este produto nas lojas pesquisadas.
              </p>
            )}

            {status === "done" && resultados.length > 0 && (
              <ul className="flex flex-col gap-2">
                {resultados.map((r, i) => (
                  <li
                    key={i}
                    className={`flex items-center justify-between gap-3 rounded-lg p-2.5 ${
                      i === 0 ? "bg-accent/10 ring-1 ring-accent" : "bg-background"
                    }`}
                  >
                    <div className="min-w-0">
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="truncate text-sm font-medium text-foreground underline-offset-2 hover:underline"
                      >
                        {r.loja}
                      </a>
                      {i === 0 && <p className="text-xs text-accent">Menor preço encontrado</p>}
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-foreground">
                      {currency.format(r.preco)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {(status === "done" || status === "saved") && geminiStatus && geminiStatus !== "ok" && (
              <p className="text-xs text-amber-400">
                Aviso:{" "}
                {geminiStatus === "sem_chave"
                  ? "sem chave da Gemini API"
                  : geminiStatus === "chave_invalida"
                    ? "chave da Gemini API inválida"
                    : "a Gemini falhou nesta busca"}{" "}
                — resultados só do Buscapé.{" "}
                {geminiStatus !== "erro" && (
                  <Link href="/diario" className="underline">
                    Configurar a chave no Diário
                  </Link>
                )}
              </p>
            )}

            {(status === "done" || status === "saved") && (
              <button
                type="button"
                onClick={closeModal}
                className="w-fit rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-background"
              >
                Fechar
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
