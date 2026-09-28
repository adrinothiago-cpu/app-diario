/**
 * Busca do menor preço de um item de compra na internet, via Gemini API com
 * a ferramenta `google_search` (grounding real com a busca do Google — sem
 * isso o modelo só "alucinaria" preços a partir do que memorizou no
 * treinamento). O prompt pede JSON estrito com as lojas encontradas; nunca
 * persistido automaticamente sem o usuário disparar a busca explicitamente
 * (ver `components/compras/price-search.tsx`).
 */
// Import relativo com `.ts`: este módulo também roda no CLI via Node puro (ver `lib/prices/search.ts`).
import { callGeminiInteraction } from "../gemini/client.ts";
import type { PurchasePriceResult } from "@/lib/events/types";

export class PriceSearchError extends Error {}

export interface PriceSearchResult {
  resultados: PurchasePriceResult[];
  modeloUsado: string;
}

export function buildPriceSearchPrompt(nome: string, observacao: string | null): string {
  const detalhes = observacao && observacao.trim() !== "" ? `\nDetalhes adicionais: ${observacao.trim()}` : "";

  return `Você tem acesso a uma ferramenta de busca do Google. Use-a ativamente para pesquisar o menor preço ATUAL para comprar o produto abaixo em lojas online que vendem e entregam no Brasil.

Produto: ${nome}${detalhes}

REGRAS:
1. Pesquise de verdade com a ferramenta de busca antes de responder — nunca invente preços de memória, só reporte o que encontrar nos resultados da busca.
2. Faça OBRIGATORIAMENTE buscas separadas nos marketplaces, além da busca geral: uma com "site:mercadolivre.com.br" e outra com "site:shopee.com.br" junto do nome do produto. Inclua os anúncios desses dois sites quando houver preço visível.
3. Só o próprio produto pedido — nunca peças, acessórios ou itens relacionados (ex.: numa busca por "parachoque", não inclua suporte, guia ou grade do parachoque).
4. Retorne até 8 resultados, no máximo 2 por loja, ordenados do mais barato para o mais caro.
5. "preco" é só o número em reais (BRL), sem símbolo de moeda nem milhar (ex.: 149.90).
6. "url" é o link direto da página do produto na loja (não a página de busca).
7. "nome" é o título do anúncio como aparece na loja.
8. Se a busca não retornar nenhum preço confiável para este produto, responda com a lista vazia.

Responda OBRIGATORIAMENTE em JSON estrito (sem markdown, sem cercas de código, sem texto antes ou depois) no seguinte formato:
{
  "resultados": [
    { "loja": "Mercado Livre", "nome": "...", "preco": 149.90, "url": "https://..." }
  ]
}`;
}

export function parsePriceSearchResponse(raw: string): PurchasePriceResult[] {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new PriceSearchError(`Resposta não é um JSON válido. Conteúdo recebido: ${raw.slice(0, 300)}`);
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as Record<string, unknown>).resultados)) {
    throw new PriceSearchError(`Campo 'resultados' ausente ou inválido no JSON: ${raw.slice(0, 300)}`);
  }

  const resultados = (parsed as { resultados: unknown[] }).resultados;

  const parsedResults = resultados.map((item, idx) => {
    if (!item || typeof item !== "object") {
      throw new PriceSearchError(`Resultado #${idx} não é um objeto: ${raw.slice(0, 300)}`);
    }
    const obj = item as Record<string, unknown>;

    if (typeof obj.loja !== "string" || obj.loja.trim() === "") {
      throw new PriceSearchError(`Resultado #${idx} sem 'loja' válida: ${raw.slice(0, 300)}`);
    }
    if (typeof obj.preco !== "number" || !Number.isFinite(obj.preco) || obj.preco <= 0) {
      throw new PriceSearchError(`Resultado #${idx} com 'preco' inválido: ${raw.slice(0, 300)}`);
    }
    if (typeof obj.url !== "string" || !/^https?:\/\//i.test(obj.url)) {
      throw new PriceSearchError(`Resultado #${idx} com 'url' inválida: ${raw.slice(0, 300)}`);
    }

    const base = { loja: obj.loja.trim(), preco: obj.preco, url: obj.url.trim() };
    return typeof obj.nome === "string" && obj.nome.trim() !== "" ? { ...base, nome: obj.nome.trim() } : base;
  });

  return [...parsedResults].sort((a, b) => a.preco - b.preco);
}

/** Orquestra: monta prompt -> chama Gemini com grounding de busca -> valida JSON. */
export async function searchLowestPrice(
  apiKey: string,
  nome: string,
  observacao: string | null,
): Promise<PriceSearchResult> {
  const prompt = buildPriceSearchPrompt(nome, observacao);
  const result = await callGeminiInteraction(apiKey, [{ type: "text", text: prompt }], {
    tools: [{ type: "google_search" }],
  });
  const resultados = parsePriceSearchResponse(result.text);
  return { resultados, modeloUsado: result.modelUsed };
}
