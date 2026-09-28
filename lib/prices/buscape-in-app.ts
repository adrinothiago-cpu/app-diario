/**
 * Busca no Buscapé a partir do app. O site não libera CORS, então o `fetch`
 * do navegador é bloqueado:
 * - Android: HTTP nativo do Capacitor (fora do WebView, sem CORS).
 * - PWA de PC: servidor local de preços (`scripts/servidor-precos.ts`,
 *   exceção de backend só pra Compras — ver `ARCHITECTURE.md`), que faz a
 *   busca e devolve os resultados já rankeados.
 */
import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { BuscapeError, searchBuscape, type PriceResult } from "./buscape";

export const LOCAL_PRICE_SERVER = "http://127.0.0.1:8787";

const NATIVE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  "Accept-Language": "pt-BR,pt;q=0.9",
};

async function fetchHtmlNative(url: string): Promise<string> {
  const res = await CapacitorHttp.get({ url, headers: NATIVE_HEADERS, responseType: "text" });
  if (res.status < 200 || res.status >= 300) throw new BuscapeError(`Buscapé respondeu ${res.status}.`);
  return typeof res.data === "string" ? res.data : String(res.data);
}

async function searchViaLocalServer(query: string): Promise<PriceResult[]> {
  let res: Response;
  try {
    res = await fetch(`${LOCAL_PRICE_SERVER}/buscape?q=${encodeURIComponent(query)}`);
  } catch {
    throw new BuscapeError(
      "servidor de preços local não está rodando — no PC, rode `npm run servidor-precos` no terminal.",
    );
  }
  const body: unknown = await res.json().catch(() => null);
  const erro = (body as { erro?: unknown } | null)?.erro;
  if (!res.ok) throw new BuscapeError(typeof erro === "string" ? erro : `servidor de preços respondeu ${res.status}.`);
  const resultados = (body as { resultados?: unknown } | null)?.resultados;
  if (!Array.isArray(resultados)) throw new BuscapeError("resposta inválida do servidor de preços.");
  return resultados as PriceResult[];
}

export function buscapeInApp(query: string): Promise<PriceResult[]> {
  return Capacitor.isNativePlatform() ? searchBuscape(query, fetchHtmlNative) : searchViaLocalServer(query);
}
