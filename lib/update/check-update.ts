/**
 * Auto-update via GitHub Releases — única chamada de rede do app que não é
 * sync do Google Drive. É intencionalmente "menos zero-knowledge que o
 * resto": consulta a API pública do GitHub para saber a versão mais recente
 * do próprio app. Não envia nenhum dado do usuário — só um GET anônimo, sem
 * autenticação, perguntando "qual a versão mais nova?". Falha em silêncio
 * (offline, GitHub fora do ar, etc.) — checar atualização nunca pode travar
 * o uso do app, que continua sendo offline-first para tudo o mais.
 *
 * Convenção de release: cada tag no GitHub é `v<versionCode>` (ex: `v2`),
 * casando com `android/app/build.gradle`'s `versionCode`. Comparação por
 * número inteiro, não por semver — mais simples e sem ambiguidade.
 */
const REPO = "adrinothiago-cpu/app-diario";

export interface UpdateInfo {
  available: boolean;
  latestVersionCode: number;
  latestVersionName: string;
  downloadUrl: string | null;
}

interface GithubAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name: string;
  name: string;
  assets: GithubAsset[];
}

export async function checkForUpdate(currentVersionCode: number): Promise<UpdateInfo | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return null;

    const release: GithubRelease = await response.json();
    const latestVersionCode = parseInt(release.tag_name.replace(/^v/, ""), 10);
    if (Number.isNaN(latestVersionCode)) return null;

    const apkAsset = release.assets.find((asset) => asset.name.endsWith(".apk"));

    return {
      available: latestVersionCode > currentVersionCode,
      latestVersionCode,
      latestVersionName: release.name || release.tag_name,
      downloadUrl: apkAsset?.browser_download_url ?? null,
    };
  } catch {
    return null;
  }
}
