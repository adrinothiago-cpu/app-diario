/** Download do HTML do Buscapé fora do navegador (CLI e servidor local de preços, em Node). */
export async function fetchHtmlDirect(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "pt-BR,pt;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`Buscapé respondeu ${res.status}.`);
  return res.text();
}
