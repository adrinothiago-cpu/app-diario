import { afterEach, describe, expect, it, vi } from "vitest";
import { checkForUpdate } from "./check-update";

function mockFetchOnce(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(body) }),
  );
}

describe("checkForUpdate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("indica atualização disponível quando a tag é maior que a versão atual", async () => {
    mockFetchOnce({
      tag_name: "v3",
      name: "Versão 1.2",
      assets: [{ name: "app-debug.apk", browser_download_url: "https://example.com/app.apk" }],
    });

    const result = await checkForUpdate(1);
    expect(result).toEqual({
      available: true,
      latestVersionCode: 3,
      latestVersionName: "Versão 1.2",
      downloadUrl: "https://example.com/app.apk",
    });
  });

  it("indica que não há atualização quando a tag é igual ou menor", async () => {
    mockFetchOnce({ tag_name: "v2", name: "v2", assets: [] });
    const result = await checkForUpdate(2);
    expect(result?.available).toBe(false);
  });

  it("retorna null se a resposta HTTP não for ok", async () => {
    mockFetchOnce({}, false);
    expect(await checkForUpdate(1)).toBeNull();
  });

  it("retorna null se a tag não seguir o padrão vN", async () => {
    mockFetchOnce({ tag_name: "not-a-version", name: "x", assets: [] });
    expect(await checkForUpdate(1)).toBeNull();
  });

  it("retorna null silenciosamente em caso de erro de rede", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await checkForUpdate(1)).toBeNull();
  });

  it("downloadUrl fica null quando não há asset .apk no release", async () => {
    mockFetchOnce({ tag_name: "v5", name: "v5", assets: [{ name: "notas.txt", browser_download_url: "x" }] });
    const result = await checkForUpdate(1);
    expect(result?.downloadUrl).toBeNull();
  });
});
