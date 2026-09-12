package com.thiago.diario;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/**
 * Baixa o APK do release (ver `lib/update/check-update.ts`) e abre o
 * instalador do sistema. O download usa o `DownloadManager` nativo do
 * Android, não `fetch` do WebView: a URL final de um asset do GitHub
 * Releases redireciona para o Azure Blob Storage, que não envia cabeçalho
 * CORS — um `fetch` cross-origin de dentro do WebView é bloqueado pelo
 * navegador mesmo a requisição de rede tendo sucesso no servidor.
 * `DownloadManager` roda fora do WebView e não é sujeito a essa restrição.
 */
@CapacitorPlugin(name = "Updater")
public class UpdaterPlugin extends Plugin {

    private static final String APK_FILENAME = "diario-update.apk";

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("url é obrigatório");
            return;
        }

        File destination = new File(getContext().getExternalFilesDir(null), APK_FILENAME);
        if (destination.exists()) destination.delete();

        DownloadManager downloadManager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
        request.setDestinationUri(Uri.fromFile(destination));
        request.setMimeType("application/vnd.android.package-archive");
        // VISIBILITY_HIDDEN exige a permissão especial DOWNLOAD_WITHOUT_NOTIFICATION
        // (lança SecurityException sem ela) — usar a opção que mostra progresso
        // é mais simples e também mais transparente para o usuário.
        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);

        // Registrado ANTES do enqueue, de propósito: o download de um APK
        // pequeno numa rede rápida pode terminar antes que o registro do
        // receiver complete se a ordem for invertida — o broadcast dispara e
        // se perde, e a Promise do JS fica pendente para sempre mesmo com o
        // arquivo já no disco (foi exatamente isso que aconteceu quando o
        // enqueue vinha primeiro).
        final long[] downloadIdHolder = new long[1];

        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                long finishedId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                if (finishedId != downloadIdHolder[0]) return;
                getContext().unregisterReceiver(this);

                if (!destination.exists() || destination.length() == 0) {
                    call.reject("Download falhou ou arquivo veio vazio.");
                    return;
                }
                try {
                    openInstaller(destination, call);
                } catch (Exception e) {
                    call.reject("Falha ao abrir o instalador: " + e.getMessage());
                }
            }
        };

        // EXPORTED (não NOT_EXPORTED): ACTION_DOWNLOAD_COMPLETE é enviado pelo
        // serviço do sistema (processo diferente do nosso), então precisa
        // poder ser recebido de fora do próprio app.
        ContextCompat.registerReceiver(
            getContext(),
            receiver,
            new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
            ContextCompat.RECEIVER_EXPORTED
        );

        try {
            downloadIdHolder[0] = downloadManager.enqueue(request);
        } catch (Exception e) {
            getContext().unregisterReceiver(receiver);
            call.reject("Falha ao iniciar o download: " + e.getMessage());
        }
    }

    private void openInstaller(File apkFile, PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent settingsIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
            settingsIntent.setData(Uri.parse("package:" + getContext().getPackageName()));
            settingsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(settingsIntent);

            JSObject ret = new JSObject();
            ret.put("opened", "settings");
            call.resolve(ret);
            return;
        }

        Uri apkUri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apkFile);

        Intent installIntent = new Intent(Intent.ACTION_VIEW);
        installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
        installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        getContext().startActivity(installIntent);

        JSObject ret = new JSObject();
        ret.put("opened", "installer");
        call.resolve(ret);
    }
}
