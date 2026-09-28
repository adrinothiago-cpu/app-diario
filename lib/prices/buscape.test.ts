import { describe, expect, it, vi } from "vitest";
import {
  BuscapeError,
  extractHitsFromHtml,
  isPlausibleMatch,
  mapHitToResult,
  normalize,
  queryRecall,
  rankResults,
  scoreMatch,
  searchBuscape,
} from "./buscape";

export function fixtureHtml(hits: unknown[]): string {
  const nextData = { props: { initialReduxState: { hits: { hits } } } };
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></body></html>`;
}

const HIT_KIDS = {
  name: "Protetor solar anasol kids fps 90 – 100G",
  price: 44.97,
  url: "/protetor-solar/protetor-solar-anasol-kids-fps-90-100g",
  bestOffer: { merchantName: "Amazon" },
};

const HIT_FACIAL = {
  name: "Anasol protetor solar facial FPS 90 clareador 60g",
  price: 66.9,
  url: "/protetor-solar/anasol-facial-fps-90-clareador",
  bestOffer: { merchantName: "Magalu" },
};

const HIT_FONE = {
  name: "Fone de ouvido bluetooth JBL",
  price: 199.9,
  url: "/fones/jbl-bluetooth",
  bestOffer: { merchantName: "Casas Bahia" },
};

describe("normalize", () => {
  it("remove acentos, baixa a caixa e normaliza pontuação", () => {
    expect(normalize("Protetor Solar Anasol FPS-90 (100g)!")).toBe("protetor solar anasol fps 90 100g");
  });
});

describe("scoreMatch", () => {
  it("dá bônus quando o nome contém a busca inteira", () => {
    expect(scoreMatch("protetor solar anasol fps 90", "Protetor solar anasol fps 90 100g")).toBeGreaterThan(1);
  });

  it("tolera texto inserido no meio do nome (variante 'kids')", () => {
    expect(scoreMatch("protetor solar anasol fps 90", HIT_KIDS.name)).toBeGreaterThan(0.6);
  });

  it("dá zero pra produto sem relação e pra strings vazias", () => {
    expect(scoreMatch("protetor solar anasol fps 90", HIT_FONE.name)).toBe(0);
    expect(scoreMatch("", "x")).toBe(0);
  });
});

describe("queryRecall", () => {
  it("ignora stopwords — coincidência só em 'que'/'não' não conta", () => {
    expect(queryRecall("produto que nao existe 12345", "O que existe o que nao existe - Livro")).toBeLessThan(0.5);
  });

  it("retorna 1 quando todas as palavras significativas aparecem", () => {
    expect(queryRecall("protetor solar anasol fps 90", HIT_KIDS.name)).toBe(1);
  });

  it("retorna 0 quando a busca só tem stopwords", () => {
    expect(queryRecall("que de para com", HIT_KIDS.name)).toBe(0);
  });
});

describe("isPlausibleMatch", () => {
  const busca = "parachoque dianteiro hb20 2016 premium";

  it("aceita o produto buscado", () => {
    expect(isPlausibleMatch(busca, "Parachoque Dianteiro Hyundai HB20 2016 Premium Preto")).toBe(true);
  });

  it("rejeita acessório do produto não pedido (achado real: guia de suporte como 'menor preço')", () => {
    expect(isPlausibleMatch(busca, "Guia Suporte Parachoque Hb20 2013 2016 Dianteiro")).toBe(false);
  });

  it("aceita o acessório quando a própria busca pede por ele", () => {
    expect(isPlausibleMatch("suporte parachoque hb20", "Suporte Parachoque Hb20 2013 2016")).toBe(true);
  });

  it("rejeita outro produto sem a palavra principal da busca (achado real: pastilha de freio)", () => {
    expect(isPlausibleMatch(busca, "Pastilha Freio Dianteiro HB20 X 2016 Premium")).toBe(false);
  });

  it("rejeita peça que só menciona o produto no meio do nome (achado real: grade do parachoque)", () => {
    expect(isPlausibleMatch(busca, "Grade Dianteira E Inferior Parachoque Hb20 2016 2017 2018")).toBe(false);
  });

  it("rejeita posição oposta à pedida (achado real: refletor do parachoque traseiro)", () => {
    expect(isPlausibleMatch(busca, "ParaChoque Traseiro HB20 2016 Premium")).toBe(false);
    expect(isPlausibleMatch(busca, "Refletor Do ParaChoque Traseiro HB20 2016 A 2019")).toBe(false);
  });

  it("aceita a marca vindo depois no nome, desde que a palavra principal esteja lá", () => {
    expect(isPlausibleMatch("protetor solar anasol fps 90", "Anasol Protetor Solar KIDS FPS 90-100 g")).toBe(true);
  });
});

describe("extractHitsFromHtml", () => {
  it("extrai a lista de hits do __NEXT_DATA__", () => {
    expect(extractHitsFromHtml(fixtureHtml([HIT_KIDS]))).toEqual([HIT_KIDS]);
  });

  it("lança BuscapeError com motivo específico em cada ponto que pode mudar", () => {
    expect(() => extractHitsFromHtml("<html></html>")).toThrowError(/não encontrado/);
    expect(() => extractHitsFromHtml(`<script id="__NEXT_DATA__">{ x </script>`)).toThrowError(/JSON válido/);
    expect(() => extractHitsFromHtml(`<script id="__NEXT_DATA__">{"props":{}}</script>`)).toThrowError(
      BuscapeError,
    );
  });
});

describe("mapHitToResult", () => {
  it("monta loja, preço, nome e url absoluta quando não há oferta", () => {
    expect(mapHitToResult(HIT_KIDS)).toEqual({
      loja: "Amazon",
      preco: 44.97,
      url: "https://www.buscape.com.br/protetor-solar/protetor-solar-anasol-kids-fps-90-100g",
      nome: HIT_KIDS.name,
    });
  });

  it("usa o link da melhor oferta (vai direto pra loja) quando existe bestOffer.id", () => {
    const hit = { ...HIT_KIDS, bestOffer: { id: "961935583", merchantName: "Amazon" } };
    expect(mapHitToResult(hit)?.url).toBe("https://www.buscape.com.br/lead?oid=961935583");
  });

  it("cai pra merchants[0] e preserva url já absoluta", () => {
    expect(mapHitToResult({ price: 10, url: "https://loja.com/x", merchants: [{ name: "Loja Y" }] })).toEqual({
      loja: "Loja Y",
      preco: 10,
      url: "https://loja.com/x",
    });
  });

  it("descarta item sem preço ou sem url", () => {
    expect(mapHitToResult({ url: "/x" })).toBeNull();
    expect(mapHitToResult({ price: 10 })).toBeNull();
  });
});

describe("rankResults", () => {
  it("filtra irrelevantes e ordena os relevantes pelo menor preço", () => {
    const r = rankResults([HIT_FACIAL, HIT_FONE, HIT_KIDS], "protetor solar anasol fps 90");
    expect(r.map((x) => x.loja)).toEqual(["Amazon", "Magalu"]);
  });

  it("não retorna nada quando só coincide via stopwords (achado real em teste)", () => {
    const livro = { name: "O que existe o que nao existe", price: 26.4, url: "/lead?oid=1" };
    expect(rankResults([livro, HIT_FONE], "xzqwvvv produto que nao existe 12345")).toEqual([]);
  });

  it("respeita o limite", () => {
    expect(rankResults([HIT_KIDS, HIT_FACIAL], "protetor solar anasol fps 90", 1)).toHaveLength(1);
  });
});

describe("searchBuscape", () => {
  it("usa o fetchHtml injetado com a url de busca e rankeia", async () => {
    const fetchHtml = vi.fn().mockResolvedValue(fixtureHtml([HIT_FACIAL, HIT_KIDS]));
    const r = await searchBuscape("protetor solar anasol fps 90", fetchHtml);
    expect(fetchHtml).toHaveBeenCalledWith(
      "https://www.buscape.com.br/search?q=protetor%20solar%20anasol%20fps%2090",
    );
    expect(r[0].loja).toBe("Amazon");
  });
});
