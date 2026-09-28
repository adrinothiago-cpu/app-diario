import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPriceSearchPrompt,
  parsePriceSearchResponse,
  PriceSearchError,
  searchLowestPrice,
} from "./gemini-price-search";

describe("buildPriceSearchPrompt", () => {
  it("inclui o nome do produto e instrui a usar a busca real", () => {
    const prompt = buildPriceSearchPrompt("Fone de ouvido XYZ", null);
    expect(prompt).toContain("Fone de ouvido XYZ");
    expect(prompt).toContain("ferramenta de busca");
    expect(prompt).toContain("nunca invente preços de memória");
  });

  it("manda buscar especificamente no Mercado Livre e na Shopee", () => {
    const prompt = buildPriceSearchPrompt("Parachoque HB20", null);
    expect(prompt).toContain("site:mercadolivre.com.br");
    expect(prompt).toContain("site:shopee.com.br");
  });

  it("inclui a observação quando presente", () => {
    const prompt = buildPriceSearchPrompt("Fone de ouvido", "modelo com cancelamento de ruído, cor preta");
    expect(prompt).toContain("Detalhes adicionais: modelo com cancelamento de ruído, cor preta");
  });

  it("omite a seção de detalhes quando a observação é vazia", () => {
    const prompt = buildPriceSearchPrompt("Fone de ouvido", "   ");
    expect(prompt).not.toContain("Detalhes adicionais");
  });
});

describe("parsePriceSearchResponse", () => {
  it("faz parse de resultados válidos e ordena do mais barato ao mais caro", () => {
    const raw = JSON.stringify({
      resultados: [
        { loja: "Loja B", preco: 200, url: "https://b.example/produto" },
        { loja: "Loja A", preco: 150.5, url: "https://a.example/produto" },
      ],
    });
    expect(parsePriceSearchResponse(raw)).toEqual([
      { loja: "Loja A", preco: 150.5, url: "https://a.example/produto" },
      { loja: "Loja B", preco: 200, url: "https://b.example/produto" },
    ]);
  });

  it("mantém o nome do anúncio quando a Gemini informa", () => {
    const raw = JSON.stringify({
      resultados: [{ loja: "Shopee", nome: "Parachoque HB20 2016", preco: 150, url: "https://shopee.com.br/x" }],
    });
    expect(parsePriceSearchResponse(raw)[0].nome).toBe("Parachoque HB20 2016");
  });

  it("aceita lista vazia (nenhum preço confiável encontrado)", () => {
    expect(parsePriceSearchResponse(JSON.stringify({ resultados: [] }))).toEqual([]);
  });

  it("remove cercas de markdown", () => {
    const wrapped = "```json\n" + JSON.stringify({ resultados: [] }) + "\n```";
    expect(parsePriceSearchResponse(wrapped)).toEqual([]);
  });

  it("rejeita JSON malformado", () => {
    expect(() => parsePriceSearchResponse("não é json")).toThrowError(PriceSearchError);
  });

  it("rejeita quando falta o campo 'resultados'", () => {
    expect(() => parsePriceSearchResponse(JSON.stringify({ foo: [] }))).toThrowError(/resultados/);
  });

  it("rejeita resultado sem loja", () => {
    const raw = JSON.stringify({ resultados: [{ preco: 100, url: "https://a.example" }] });
    expect(() => parsePriceSearchResponse(raw)).toThrowError(/loja/);
  });

  it("rejeita preco não numérico ou não positivo", () => {
    const raw = JSON.stringify({ resultados: [{ loja: "X", preco: 0, url: "https://a.example" }] });
    expect(() => parsePriceSearchResponse(raw)).toThrowError(/preco/);
  });

  it("rejeita url que não começa com http", () => {
    const raw = JSON.stringify({ resultados: [{ loja: "X", preco: 10, url: "ftp://a.example" }] });
    expect(() => parsePriceSearchResponse(raw)).toThrowError(/url/);
  });
});

describe("searchLowestPrice", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("chama a Gemini API com a ferramenta google_search e retorna os resultados parseados", async () => {
    const mockResponse = {
      output_text: JSON.stringify({
        resultados: [{ loja: "Loja X", preco: 99.9, url: "https://x.example/produto" }],
      }),
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
      text: () => Promise.resolve(JSON.stringify(mockResponse)),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchLowestPrice("chave-teste", "Produto Y", null);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.tools).toEqual([{ type: "google_search" }]);
    expect(result).toEqual({
      resultados: [{ loja: "Loja X", preco: 99.9, url: "https://x.example/produto" }],
      modeloUsado: "gemini-3.8-flash",
    });
  });
});
