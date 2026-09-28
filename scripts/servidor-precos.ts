#!/usr/bin/env node
/**
 * Servidor local de preços — exceção de backend só pra Compras (ver
 * `ARCHITECTURE.md`). Existe porque o Buscapé não libera CORS: no PWA de PC
 * o navegador não consegue consultá-lo direto (no Android o app usa o HTTP
 * nativo e não precisa disto).
 *
 * Superfície mínima de propósito: escuta só em 127.0.0.1 (nunca na rede),
 * só aceita o app local como origem, e só expõe GET /buscape?q= — faz a
 * busca e o ranking aqui e devolve só { resultados }, em vez de ser um
 * proxy genérico de URL (que qualquer página poderia usar pra buscar
 * qualquer coisa em nome desta máquina). Não guarda nada.
 *
 * Uso: npm run servidor-precos (ou npm run dev:compras, que sobe junto do Next).
 */
import { createServer } from "node:http";
import { searchBuscape } from "../lib/prices/buscape.ts";
import { fetchHtmlDirect } from "../lib/prices/fetch-html-direct.ts";

const PORT = Number(process.env.PRECOS_PORT ?? 8787);
const ORIGENS_PERMITIDAS = new Set(["http://localhost:3000", "http://127.0.0.1:3000"]);
const MAX_QUERY = 200;

const server = createServer(async (req, res) => {
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
  };

  // Sem Origin = chamada fora de navegador (curl, terminal) — ok, só escuta local.
  // Com Origin de outro site, recusa antes de fazer qualquer busca em nome desta máquina.
  const origin = req.headers.origin;
  if (origin) {
    if (!ORIGENS_PERMITIDAS.has(origin)) {
      json(403, { erro: "Origem não permitida." });
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  if (req.method !== "GET" || url.pathname !== "/buscape") {
    json(404, { erro: "Rota inexistente." });
    return;
  }

  const q = url.searchParams.get("q")?.trim() ?? "";
  if (!q || q.length > MAX_QUERY) {
    json(400, { erro: `Parâmetro q obrigatório (até ${MAX_QUERY} caracteres).` });
    return;
  }

  try {
    const resultados = await searchBuscape(q, fetchHtmlDirect);
    console.log(`[${new Date().toLocaleTimeString("pt-BR")}] "${q}" → ${resultados.length} resultado(s)`);
    json(200, { resultados });
  } catch (err) {
    const erro = err instanceof Error ? err.message : String(err);
    console.error(`[${new Date().toLocaleTimeString("pt-BR")}] "${q}" → erro: ${erro}`);
    json(502, { erro });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Servidor de preços em http://127.0.0.1:${PORT} (só local). Ctrl+C pra parar.`);
});
