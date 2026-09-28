import { afterEach, describe, expect, it, vi } from "vitest";
import { searchBuscape } from "./buscape";
import { PriceSearchUnavailableError, searchPricesAllSources } from "./search";

function buscapeHtml(hits: unknown[]): string {
  const nextData = { props: { initialReduxState: { hits: { hits } } } };
  return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>`;
}

const BUSCAPE_HIT = {
  name: "Protetor solar anasol fps 90",
  price: 49.9,
  url: "/lead?oid=1",
  bestOffer: { merchantName: "Magazine Luiza" },
};

function mockGeminiFetch(response: { ok: boolean; status: number; body: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: response.ok,
      status: response.status,
      json: () => Promise.resolve(response.body),
      text: () => Promise.resolve(JSON.stringify(response.body)),
    }),
  );
}

const base = { nome: "protetor solar anasol fps 90", observacao: null };

describe("searchPricesAllSources", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sem chave da Gemini: segue só com o Buscapé e marca sem_chave", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const busca = await searchPricesAllSources({
      ...base,
      geminiApiKey: null,
      buscape: (q) => searchBuscape(q, async () => buscapeHtml([BUSCAPE_HIT])),
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(busca.gemini.status).toBe("sem_chave");
    expect(busca.resultados).toHaveLength(1);
    expect(busca.fontes).toEqual(["buscape.com.br"]);
  });

  it("chave inválida: não derruba a busca, marca chave_invalida e mantém o Buscapé", async () => {
    mockGeminiFetch({
      ok: false,
      status: 400,
      body: [{ error: { code: 400, message: "API key not valid.", details: [{ reason: "API_KEY_INVALID" }] } }],
    });
    const busca = await searchPricesAllSources({
      ...base,
      geminiApiKey: "chave-falsa",
      buscape: (q) => searchBuscape(q, async () => buscapeHtml([BUSCAPE_HIT])),
    });
    expect(busca.gemini.status).toBe("chave_invalida");
    expect(busca.resultados[0].loja).toBe("Magazine Luiza");
  });

  it("junta as duas fontes, remove url repetida e ordena pelo menor preço", async () => {
    mockGeminiFetch({
      ok: true,
      status: 200,
      body: {
        output_text: JSON.stringify({
          resultados: [
            { loja: "Droga Raia", preco: 39.9, url: "https://raia.example/p" },
            { loja: "Magazine Luiza", preco: 49.9, url: "https://www.buscape.com.br/lead?oid=1" },
          ],
        }),
      },
    });
    const busca = await searchPricesAllSources({
      ...base,
      geminiApiKey: "chave-ok",
      buscape: (q) => searchBuscape(q, async () => buscapeHtml([BUSCAPE_HIT])),
    });
    expect(busca.gemini.status).toBe("ok");
    expect(busca.resultados.map((r) => r.preco)).toEqual([39.9, 49.9]);
    expect(busca.fontes).toContain("buscape.com.br");
  });

  it("Buscapé falhou mas a Gemini respondeu: retorna os da Gemini", async () => {
    mockGeminiFetch({
      ok: true,
      status: 200,
      body: { output_text: JSON.stringify({ resultados: [{ loja: "X", preco: 10, url: "https://x.example" }] }) },
    });
    const busca = await searchPricesAllSources({
      ...base,
      geminiApiKey: "chave-ok",
      buscape: async () => {
        throw new Error("CORS");
      },
    });
    expect(busca.buscape.status).toBe("erro");
    expect(busca.resultados).toHaveLength(1);
  });

  it("nenhuma fonte respondeu: lança erro carregando o status da Gemini", async () => {
    const promise = searchPricesAllSources({
      ...base,
      geminiApiKey: null,
      buscape: async () => {
        throw new Error("CORS");
      },
    });
    await expect(promise).rejects.toBeInstanceOf(PriceSearchUnavailableError);
    await expect(promise).rejects.toMatchObject({ gemini: { status: "sem_chave" } });
  });
});
