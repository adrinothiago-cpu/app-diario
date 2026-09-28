#!/usr/bin/env node
/**
 * CLI (fora do build do Next — não entra no `out/` nem no APK): menor preço
 * de um produto usando as mesmas fontes da automação do app (Buscapé +
 * Gemini). Uso: npm run buscar-preco -- "nome do produto"
 *
 * Chave da Gemini: lida de `GEMINI_API_KEY` no `.env.local` da raiz do
 * projeto (local padrão do Next.js, já ignorado pelo git via `.env*`). O
 * cofre do app não serve aqui — lá a chave fica cifrada no IndexedDB do
 * navegador. Sem chave, a busca segue só com o Buscapé e avisa no final.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { searchBuscape } from "../lib/prices/buscape.ts";
import { fetchHtmlDirect } from "../lib/prices/fetch-html-direct.ts";
import { searchPricesAllSources } from "../lib/prices/search.ts";

const ENV_PATH = fileURLToPath(new URL("../.env.local", import.meta.url));
if (existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH);
const geminiApiKey = process.env.GEMINI_API_KEY?.trim() || null;

const query = process.argv.slice(2).join(" ").trim();
if (!query) {
  console.error('Uso: npm run buscar-preco -- "nome do produto"');
  process.exit(1);
}

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

try {
  console.log(`Buscando "${query}"...\n`);
  const busca = await searchPricesAllSources({
    geminiApiKey,
    nome: query,
    observacao: null,
    buscape: (q) => searchBuscape(q, fetchHtmlDirect),
  });

  if (busca.resultados.length === 0) {
    console.log("Nenhum resultado relevante encontrado.");
  }
  busca.resultados.forEach((r, i) => {
    console.log(`${i + 1}. ${currency.format(r.preco)} — ${r.loja}${i === 0 ? " (menor preço)" : ""}`);
    if (r.nome) console.log(`   ${r.nome}`);
    console.log(`   ${r.url}\n`);
  });

  console.log(`Fontes: ${busca.fontes.join(", ")}`);
  if (busca.gemini.status === "sem_chave") {
    console.log(`\nAviso: sem chave da Gemini — resultados só do Buscapé.`);
    console.log(`Coloque GEMINI_API_KEY=sua_chave em ${ENV_PATH}`);
  } else if (busca.gemini.status === "chave_invalida") {
    console.log(`\nAviso: a GEMINI_API_KEY em ${ENV_PATH} é inválida — resultados só do Buscapé.`);
  } else if (busca.gemini.status === "erro") {
    console.log(`\nAviso: Gemini falhou (${busca.gemini.erro}) — resultados só do Buscapé.`);
  }
  if (busca.buscape.status === "erro") {
    console.log(`\nAviso: Buscapé falhou (${busca.buscape.erro}) — resultados só da Gemini.`);
  }
} catch (err) {
  console.error("Falha na busca:", err instanceof Error ? err.message : err);
  process.exit(1);
}
