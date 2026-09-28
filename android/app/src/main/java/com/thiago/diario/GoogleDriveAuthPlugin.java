package com.thiago.diario;

import android.app.PendingIntent;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;
import java.util.Collections;

/**
 * Token de acesso ao Google Drive (escopo só `drive.appdata`) pro
 * `lib/sync/google-auth.ts`. O Google bloqueia a página de login dentro de
 * WebView, então o login passa pelo `AuthorizationClient` do Google Play
 * Services. Depois do primeiro consentimento o sistema devolve (e renova)
 * o token sem mostrar tela — `interactive: false` falha com
 * `NEEDS_INTERACTION` só quando uma tela seria necessária.
 *
 * Exige no Google Cloud um cliente OAuth "Android" com o pacote
 * `com.thiago.diario` e o SHA-1 do certificado que assina o APK, no mesmo
 * projeto do cliente "Web" usado no PC (a `appDataFolder` é por projeto).
 */
@CapacitorPlugin(name = "GoogleDriveAuth")
public class GoogleDriveAuthPlugin extends Plugin {

    private static final String DRIVE_APPDATA = "https://www.googleapis.com/auth/drive.appdata";

    private ActivityResultLauncher<IntentSenderRequest> consentLauncher;
    private PluginCall pendingCall;

    @Override
    public void load() {
        // Registrado no load() (durante o onCreate da activity) — depois disso o
        // androidx não aceita mais registrar launchers.
        consentLauncher = getActivity().registerForActivityResult(
            new ActivityResultContracts.StartIntentSenderForResult(),
            result -> {
                PluginCall call = pendingCall;
                pendingCall = null;
                if (call == null) return;
                try {
                    AuthorizationResult auth = Identity.getAuthorizationClient(getActivity())
                        .getAuthorizationResultFromIntent(result.getData());
                    resolveToken(call, auth);
                } catch (ApiException e) {
                    call.reject("Login do Google cancelado ou recusado.", "AUTH_FAILED", e);
                }
            }
        );
    }

    @PluginMethod
    public void authorize(PluginCall call) {
        boolean interactive = Boolean.TRUE.equals(call.getBoolean("interactive", false));
        AuthorizationRequest request = AuthorizationRequest.builder()
            .setRequestedScopes(Collections.singletonList(new Scope(DRIVE_APPDATA)))
            .build();

        Identity.getAuthorizationClient(getActivity())
            .authorize(request)
            .addOnSuccessListener(result -> {
                if (!result.hasResolution()) {
                    resolveToken(call, result);
                    return;
                }
                if (!interactive) {
                    call.reject("Precisa conectar a conta Google.", "NEEDS_INTERACTION");
                    return;
                }
                PendingIntent pendingIntent = result.getPendingIntent();
                if (pendingIntent == null) {
                    call.reject("Google não devolveu a tela de consentimento.", "AUTH_FAILED");
                    return;
                }
                pendingCall = call;
                consentLauncher.launch(new IntentSenderRequest.Builder(pendingIntent.getIntentSender()).build());
            })
            .addOnFailureListener(e -> call.reject("Falha no login do Google: " + e.getMessage(), "AUTH_FAILED", e));
    }

    private void resolveToken(PluginCall call, AuthorizationResult result) {
        String token = result.getAccessToken();
        if (token == null) {
            call.reject("Google não devolveu o token de acesso.", "AUTH_FAILED");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("accessToken", token);
        call.resolve(ret);
    }
}
