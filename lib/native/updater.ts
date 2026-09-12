/**
 * Aciona `UpdaterPlugin.downloadAndInstall`
 * (`android/app/src/main/java/com/thiago/diario/UpdaterPlugin.java`), que
 * baixa o APK via `DownloadManager` nativo e abre o instalador do sistema.
 *
 * O download é inteiramente nativo — não passa por `fetch` do WebView. A
 * URL de um asset do GitHub Releases redireciona para o Azure Blob Storage,
 * que não envia cabeçalho CORS; um `fetch` cross-origin de dentro do
 * WebView é bloqueado pelo navegador mesmo com a requisição tendo sucesso
 * no servidor (a primeira versão deste updater tentou isso e falhava
 * sempre com "Falha ao baixar").
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

interface UpdaterPluginInterface {
  downloadAndInstall(options: { url: string }): Promise<{ opened: "installer" | "settings" }>;
}

const Updater = registerPlugin<UpdaterPluginInterface>("Updater");

/**
 * Retorna `"installer"` se o instalador do sistema foi aberto, ou
 * `"settings"` se em vez disso o Android abriu a tela de "permitir
 * instalar apps desconhecidos" — nesse caso o usuário precisa habilitar e
 * tentar de novo (não dá pra encadear automaticamente: é uma permissão
 * especial concedida só por interação manual do usuário).
 */
export async function downloadAndInstallUpdate(downloadUrl: string): Promise<"installer" | "settings"> {
  if (Capacitor.getPlatform() !== "android") {
    throw new Error("Auto-update só é suportado no Android nativo.");
  }
  const { opened } = await Updater.downloadAndInstall({ url: downloadUrl });
  return opened;
}
