/**
 * Baixa o APK do release (URL vinda de `checkForUpdate`) e aciona o
 * instalador do sistema via `UpdaterPlugin`
 * (`android/app/src/main/java/com/thiago/diario/UpdaterPlugin.java`).
 * Guarda o arquivo em `Directory.Cache` — é descartável, não faz sentido
 * manter o instalador antigo depois de instalado.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { arrayBufferToBase64 } from "@/lib/audio/encoding";

interface UpdaterPluginInterface {
  installApk(options: { path: string }): Promise<{ opened: "installer" | "settings" }>;
}

const Updater = registerPlugin<UpdaterPluginInterface>("Updater");

const APK_FILENAME = "diario-update.apk";

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

  const response = await fetch(downloadUrl);
  if (!response.ok) throw new Error(`Falha ao baixar atualização: HTTP ${response.status}`);
  const base64 = arrayBufferToBase64(await response.arrayBuffer());

  const { uri } = await Filesystem.writeFile({
    path: APK_FILENAME,
    directory: Directory.Cache,
    data: base64,
  });

  const { opened } = await Updater.installApk({ path: uri.replace("file://", "") });
  return opened;
}
