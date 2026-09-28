/**
 * Busca de menor preço no Buscapé (buscape.com.br) — agregador que já indexa
 * várias lojas brasileiras (Amazon, Magalu, Mercado Livre...) por produto.
 * Segunda fonte, sem chave de API, pra automação de Compras não depender só
 * da Gemini.
 *
 * Por que Buscapé e não scraping direto de Mercado Livre/Amazon: os dois
 * bloqueiam requisição simples (ML redireciona pra verificação de conta,
 * Amazon devolve página anti-bot; a API pública de busca por texto do ML
 * responde 403 sem credencial de app). O Buscapé responde 200 e embute os
 * resultados como JSON de estado (`__NEXT_DATA__`) na própria página.
 *
 * Frágil por natureza: depende da estrutura interna (não documentada) da
 * página. Cada ponto onde ela pode mudar lança erro com mensagem específica.
 *
 * Sem imports de propósito: roda tanto no app quanto no CLI
 * `scripts/buscar-preco.ts` (Node puro com type stripping). O download do
 * HTML é injetado (`fetchHtml`) porque no app precisa passar pelo HTTP
 * nativo do Capacitor — o Buscapé não libera CORS pro navegador.
 */

export interface PriceResult {
  loja: string;
  preco: number;
  url: string;
  /** Nome do produto na loja — distingue variantes (tamanho, versão) com o mesmo preço/loja. */
  nome?: string;
}

export type FetchHtml = (url: string) => Promise<string>;

export class BuscapeError extends Error {}

const BUSCAPE_ORIGIN = "https://www.buscape.com.br";

/**
 * Palavras comuns demais pra contar como sinal de correspondência — sem
 * isso, uma busca sem produto real correspondente batia com títulos
 * aleatórios só por coincidência de "que"/"não" (visto em teste real).
 */
const STOPWORDS = new Set([
  "que", "nao", "de", "da", "do", "das", "dos", "com", "para", "por", "o", "a",
  "os", "as", "um", "uma", "uns", "umas", "e", "ou", "em", "no", "na", "nos",
  "nas", "mais", "menos", "ate", "sem", "sob", "sobre", "entre", "the", "of", "and",
]);

export function buscapeSearchUrl(query: string): string {
  return `${BUSCAPE_ORIGIN}/search?q=${encodeURIComponent(query)}`;
}

/** Remove acentos, baixa a caixa e normaliza pontuação/espaços. */
export function normalize(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokens normalizados sem stopwords nem palavras de 1 caractere. */
export function meaningfulTokens(str: string): string[] {
  return normalize(str)
    .split(" ")
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Relevância pra ordenar candidatos já plausíveis: Jaccard das palavras
 * significativas + bônus quando o nome contém a busca inteira. Não veta
 * nada sozinho — quem veta é `queryRecall` (ver `rankResults`).
 */
export function scoreMatch(query: string, candidateName: string): number {
  const nq = normalize(query);
  const nc = normalize(candidateName);
  if (!nq || !nc) return 0;

  const qTokens = new Set(meaningfulTokens(query));
  const cTokens = new Set(meaningfulTokens(candidateName));
  if (qTokens.size === 0) return 0;

  let intersection = 0;
  for (const t of qTokens) if (cTokens.has(t)) intersection++;
  const union = new Set([...qTokens, ...cTokens]).size;
  const jaccard = union === 0 ? 0 : intersection / union;

  return (nc.includes(nq) ? 1 : 0) + jaccard;
}

/** Fração das palavras significativas da busca que aparecem no candidato. */
export function queryRecall(query: string, candidateName: string): number {
  const qTokens = meaningfulTokens(query);
  if (qTokens.length === 0) return 0;
  const cTokens = new Set(meaningfulTokens(candidateName));
  return qTokens.filter((t) => cTokens.has(t)).length / qTokens.length;
}

interface BuscapeHit {
  name?: string;
  shortName?: string;
  price?: unknown;
  url?: unknown;
  bestOffer?: { id?: unknown; merchantName?: string };
  merchants?: { name?: string }[];
}

export function extractHitsFromHtml(html: string): BuscapeHit[] {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new BuscapeError("Bloco __NEXT_DATA__ não encontrado na página — o Buscapé pode ter mudado o layout.");
  }

  let data: unknown;
  try {
    data = JSON.parse(match[1]);
  } catch {
    throw new BuscapeError("Bloco __NEXT_DATA__ não é um JSON válido — o Buscapé pode ter mudado o layout.");
  }

  const hits = (data as { props?: { initialReduxState?: { hits?: { hits?: unknown } } } })?.props
    ?.initialReduxState?.hits?.hits;
  if (!Array.isArray(hits)) {
    throw new BuscapeError(
      "Lista de resultados não encontrada no __NEXT_DATA__ — o Buscapé pode ter mudado a estrutura interna.",
    );
  }
  return hits as BuscapeHit[];
}

/**
 * Link: resultado do tipo "produto" aponta pra página de comparação do
 * Buscapé; quando há `bestOffer.id`, usa o link de redirecionamento dessa
 * oferta (`/lead?oid=`), que leva direto à página da loja — mesmo link que
 * o próprio site usa no botão "ir à loja". Nunca é seguido automaticamente:
 * cada acesso a ele registra um clique pago pela loja ao Buscapé, então só
 * o clique real do usuário deve abri-lo.
 */
export function mapHitToResult(hit: BuscapeHit): PriceResult | null {
  if (typeof hit.price !== "number" || hit.price <= 0 || typeof hit.url !== "string") return null;
  const loja = hit.bestOffer?.merchantName ?? hit.merchants?.[0]?.name ?? "Loja não identificada";
  const offerId = hit.bestOffer?.id;
  const url =
    typeof offerId === "string" || typeof offerId === "number"
      ? `${BUSCAPE_ORIGIN}/lead?oid=${encodeURIComponent(String(offerId))}`
      : hit.url.startsWith("http")
        ? hit.url
        : `${BUSCAPE_ORIGIN}${hit.url}`;
  const nome = hit.name ?? hit.shortName;
  return nome ? { loja, preco: hit.price, url, nome } : { loja, preco: hit.price, url };
}

/**
 * Peças/acessórios que costumam aparecer na busca do produto principal e,
 * por serem baratos, "ganhavam" o menor preço (visto em teste real: "guia
 * de suporte do parachoque" a R$ 16,99 como menor preço de "parachoque
 * dianteiro hb20"). Só vetam o item quando a busca não pediu o acessório.
 */
const ACCESSORY_TERMS = new Set([
  "suporte", "guia", "capa", "capinha", "case", "pelicula", "adesivo", "refil",
  "moldura", "presilha", "parafuso", "trava", "bucha", "reparo", "friso",
  "emblema", "ponteira", "grampo", "refletor",
]);

/** Posições opostas: busca por uma exclui item que diz a outra ("dianteiro" x "traseiro"). */
const OPPOSITES: Record<string, string> = {
  dianteiro: "traseiro", traseiro: "dianteiro",
  dianteira: "traseira", traseira: "dianteira",
  esquerdo: "direito", direito: "esquerdo",
  esquerda: "direita", direita: "esquerda",
};

/**
 * Candidato é o produto buscado (não só algo parecido)? Exige, além de
 * metade das palavras significativas da busca no nome:
 * - a palavra principal (1ª significativa, normalmente o tipo do produto
 *   ou a marca) entre as duas primeiras do nome — elimina "pastilha de
 *   freio dianteiro hb20" e "grade dianteira ... parachoque" numa busca por
 *   "parachoque dianteiro hb20" (achados reais), mas aceita marca na frente
 *   ("Anasol Protetor Solar");
 * - nenhum termo de acessório que a busca não tenha pedido;
 * - nenhuma posição oposta à pedida (achado real: "refletor do parachoque
 *   traseiro" numa busca por "parachoque dianteiro").
 */
export function isPlausibleMatch(query: string, candidateName: string): boolean {
  const qTokens = meaningfulTokens(query);
  if (qTokens.length === 0) return false;
  const cList = meaningfulTokens(candidateName);
  // Nome de produto começa pelo que ele é (às vezes precedido da marca):
  // "Grade Dianteira ... Parachoque" é uma grade, não um parachoque.
  if (!cList.slice(0, 2).includes(qTokens[0])) return false;
  const cTokens = new Set(cList);
  const qSet = new Set(qTokens);
  for (const t of cTokens) {
    if (ACCESSORY_TERMS.has(t) && !qSet.has(t)) return false;
    const oposto = OPPOSITES[t];
    if (oposto && qSet.has(oposto) && !qSet.has(t)) return false;
  }
  return queryRecall(query, candidateName) >= 0.5;
}

/**
 * Mantém só candidatos plausíveis (`isPlausibleMatch`), pega os mais
 * relevantes e, entre eles, ordena pelo menor preço.
 */
export function rankResults(hits: BuscapeHit[], query: string, limit = 10): PriceResult[] {
  return hits
    .map((hit) => {
      const nome = hit.name ?? hit.shortName ?? "";
      return { hit, nome, score: scoreMatch(query, nome) };
    })
    .filter(({ nome }) => isPlausibleMatch(query, nome))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit * 2)
    .map(({ hit }) => mapHitToResult(hit))
    .filter((r): r is PriceResult => r !== null)
    .sort((a, b) => a.preco - b.preco)
    .slice(0, limit);
}

export async function searchBuscape(query: string, fetchHtml: FetchHtml, limit = 10): Promise<PriceResult[]> {
  const html = await fetchHtml(buscapeSearchUrl(query));
  return rankResults(extractHitsFromHtml(html), query, limit);
}
