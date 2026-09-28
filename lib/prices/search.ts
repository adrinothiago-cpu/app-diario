/**
 * Busca de menor preço combinando as duas fontes: Gemini (grounding com
 * Google, precisa de chave) e Buscapé (sem chave). As duas rodam em
 * paralelo e uma falhar nunca derruba a outra — a automação só para quando
 * nenhuma fonte trouxe nada. O status da Gemini volta separado pra quem
 * chamou poder avisar no final que faltou/era inválida a chave, sem
 * interromper os resultados.
 *
 * Imports relativos com extensão `.ts`: este módulo também roda no CLI
 * `scripts/buscar-preco.ts` via Node puro (type stripping), que não resolve
 * o alias `@/`.
 */
import { GeminiInvalidKeyError } from "../gemini/client.ts";
import { searchLowestPrice } from "../insights/gemini-price-search.ts";
import type { PriceResult } from "./buscape.ts";

/** Busca no Buscapé já resolvida pro ambiente (Android nativo, servidor local no PC, CLI). */
export type BuscapeSearch = (query: string) => Promise<PriceResult[]>;

export type GeminiStatus = "ok" | "sem_chave" | "chave_invalida" | "erro";

export interface CombinedPriceSearch {
  resultados: PriceResult[];
  /** Fontes que responderam (ex.: "gemini-3.8-flash", "buscape.com.br") — vai pro `modeloUsado` do evento. */
  fontes: string[];
  gemini: { status: GeminiStatus; erro?: string };
  buscape: { status: "ok" | "erro"; erro?: string };
}

export class PriceSearchUnavailableError extends Error {
  gemini: CombinedPriceSearch["gemini"];

  constructor(message: string, gemini: CombinedPriceSearch["gemini"]) {
    super(message);
    this.gemini = gemini;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function searchPricesAllSources(params: {
  geminiApiKey: string | null;
  nome: string;
  observacao: string | null;
  buscape: BuscapeSearch;
  limit?: number;
}): Promise<CombinedPriceSearch> {
  const { geminiApiKey, nome, observacao, buscape: buscarNoBuscape, limit = 10 } = params;
  const query = observacao && observacao.trim() !== "" ? `${nome} ${observacao.trim()}` : nome;

  const [geminiRes, buscapeRes] = await Promise.allSettled([
    geminiApiKey ? searchLowestPrice(geminiApiKey, nome, observacao) : Promise.resolve(null),
    buscarNoBuscape(query),
  ]);

  const resultados: PriceResult[] = [];
  const fontes: string[] = [];
  let gemini: CombinedPriceSearch["gemini"];
  let buscape: CombinedPriceSearch["buscape"];

  if (geminiRes.status === "fulfilled" && geminiRes.value === null) {
    gemini = { status: "sem_chave" };
  } else if (geminiRes.status === "fulfilled" && geminiRes.value) {
    gemini = { status: "ok" };
    resultados.push(...geminiRes.value.resultados);
    fontes.push(geminiRes.value.modeloUsado);
  } else {
    const reason = geminiRes.status === "rejected" ? geminiRes.reason : null;
    gemini = {
      status: reason instanceof GeminiInvalidKeyError ? "chave_invalida" : "erro",
      erro: errorMessage(reason),
    };
  }

  if (buscapeRes.status === "fulfilled") {
    buscape = { status: "ok" };
    resultados.push(...buscapeRes.value);
    fontes.push("buscape.com.br");
  } else {
    buscape = { status: "erro", erro: errorMessage(buscapeRes.reason) };
  }

  if (gemini.status !== "ok" && buscape.status !== "ok") {
    const motivoGemini =
      gemini.status === "sem_chave" ? "Gemini sem chave configurada" : `Gemini: ${gemini.erro?.replace(/\.+$/, "")}`;
    throw new PriceSearchUnavailableError(
      `Nenhuma fonte respondeu. ${motivoGemini}. Buscapé: ${buscape.erro}`,
      gemini,
    );
  }

  const vistos = new Set<string>();
  const unicos = resultados
    .sort((a, b) => a.preco - b.preco)
    .filter((r) => (vistos.has(r.url) ? false : (vistos.add(r.url), true)))
    .slice(0, limit);

  return { resultados: unicos, fontes, gemini, buscape };
}
