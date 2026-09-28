import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMultipartBody, createDriveApi, DriveAuthError } from "./drive";

function res(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    arrayBuffer: async () => new TextEncoder().encode(String(body)).buffer,
  };
}

describe("buildMultipartBody", () => {
  it("monta metadados JSON + conteúdo no formato multipart/related", async () => {
    const blob = buildMultipartBody({ name: "a.enc", parents: ["appDataFolder"] }, "BYTES", "application/octet-stream", "B");
    const text = await blob.text();
    expect(text).toContain('--B\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"name":"a.enc","parents":["appDataFolder"]}');
    expect(text).toContain("--B\r\nContent-Type: application/octet-stream\r\n\r\nBYTES\r\n--B--");
  });
});

describe("createDriveApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lista só a appDataFolder e segue a paginação", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(200, { files: [{ id: "1", name: "a" }], nextPageToken: "p2" }))
      .mockResolvedValueOnce(res(200, { files: [{ id: "2", name: "b" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const files = await createDriveApi("tok").listFiles();

    expect(files.map((f) => f.id)).toEqual(["1", "2"]);
    expect(fetchMock.mock.calls[0][0]).toContain("spaces=appDataFolder");
    expect(fetchMock.mock.calls[1][0]).toContain("pageToken=p2");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
  });

  it("envia o arquivo sempre dentro da appDataFolder", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200, { id: "x" }));
    vi.stubGlobal("fetch", fetchMock);

    await createDriveApi("tok").upload("evt_1_a.enc", new ArrayBuffer(3), "application/octet-stream");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("uploadType=multipart");
    expect(await (init.body as Blob).text()).toContain('"parents":["appDataFolder"]');
  });

  it("token expirado vira DriveAuthError (quem chama pede login de novo)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res(401, "unauthorized")));
    await expect(createDriveApi("tok").listFiles()).rejects.toBeInstanceOf(DriveAuthError);
  });
});
