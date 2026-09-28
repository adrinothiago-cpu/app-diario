/**
 * Cliente mínimo da Drive REST API v3, restrito à `appDataFolder` — pasta
 * oculta, exclusiva deste app no Drive do usuário (o escopo `drive.appdata`
 * não enxerga nenhum outro arquivo dele). Só trafega bytes já cifrados: o
 * Google nunca vê conteúdo em claro.
 *
 * Sem SDK do Google: `fetch` direto, que a API aceita via CORS tanto do
 * navegador do PC quanto do WebView do Android. O token vem de
 * `lib/sync/google-auth.ts`.
 */

const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";

export interface DriveFile {
  id: string;
  name: string;
}

export interface DriveApi {
  listFiles(): Promise<DriveFile[]>;
  download(fileId: string): Promise<ArrayBuffer>;
  upload(name: string, body: ArrayBuffer | string, contentType: string): Promise<void>;
}

/** Token expirado/revogado — quem chama pede um novo login. */
export class DriveAuthError extends Error {}
export class DriveError extends Error {}

async function check(res: Response, acao: string): Promise<Response> {
  if (res.ok) return res;
  const body = await res.text().catch(() => "");
  if (res.status === 401) throw new DriveAuthError("Login do Google expirou — conecte de novo.");
  throw new DriveError(`Google Drive falhou ao ${acao} (${res.status}): ${body.slice(0, 200)}`);
}

/** Corpo multipart/related (metadados JSON + conteúdo) — formato do upload simples da Drive API. */
export function buildMultipartBody(
  metadata: object,
  body: ArrayBuffer | string,
  contentType: string,
  boundary: string,
): Blob {
  return new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
    body,
    `\r\n--${boundary}--`,
  ]);
}

export function createDriveApi(accessToken: string): DriveApi {
  const auth = { Authorization: `Bearer ${accessToken}` };

  return {
    async listFiles() {
      const files: DriveFile[] = [];
      let pageToken: string | undefined;
      do {
        const params = new URLSearchParams({
          spaces: "appDataFolder",
          fields: "nextPageToken,files(id,name)",
          pageSize: "1000",
        });
        if (pageToken) params.set("pageToken", pageToken);
        const res = await check(await fetch(`${API}?${params}`, { headers: auth }), "listar arquivos");
        const data = (await res.json()) as { files?: DriveFile[]; nextPageToken?: string };
        files.push(...(data.files ?? []));
        pageToken = data.nextPageToken;
      } while (pageToken);
      return files;
    },

    async download(fileId) {
      const res = await check(
        await fetch(`${API}/${encodeURIComponent(fileId)}?alt=media`, { headers: auth }),
        "baixar arquivo",
      );
      return res.arrayBuffer();
    },

    async upload(name, body, contentType) {
      const boundary = `diario-${crypto.randomUUID()}`;
      await check(
        await fetch(`${UPLOAD_API}?uploadType=multipart&fields=id`, {
          method: "POST",
          headers: { ...auth, "Content-Type": `multipart/related; boundary=${boundary}` },
          body: buildMultipartBody({ name, parents: ["appDataFolder"] }, body, contentType, boundary),
        }),
        "enviar arquivo",
      );
    },
  };
}
