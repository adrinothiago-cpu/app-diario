package com.thiago.diario;

import android.Manifest;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Garante a permissão RECORD_AUDIO nativa antes de o diário chamar
 * `getUserMedia` no WebView. Sem isso, o fluxo de permissão do
 * `PermissionRequest` do próprio WebView (que dispara o diálogo do sistema
 * durante a chamada de `getUserMedia`) se mostrou pouco confiável: mesmo
 * concedendo no diálogo, `getUserMedia` seguia rejeitando com
 * `NotAllowedError`. Pedindo a permissão antes, por este canal nativo já
 * usado por `@capacitor/geolocation`, a chamada de `getUserMedia`
 * subsequente encontra a permissão já concedida e não depende mais desse
 * fluxo problemático.
 */
@CapacitorPlugin(
    name = "Microphone",
    permissions = { @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }) }
)
public class MicrophonePlugin extends Plugin {

    @PluginMethod
    public void checkMicrophonePermission(PluginCall call) {
        resolve(call, getPermissionState("microphone") == PermissionState.GRANTED);
    }

    @PluginMethod
    public void requestMicrophonePermission(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            resolve(call, true);
        } else {
            requestPermissionForAlias("microphone", call, "microphonePermsCallback");
        }
    }

    @PermissionCallback
    private void microphonePermsCallback(PluginCall call) {
        resolve(call, getPermissionState("microphone") == PermissionState.GRANTED);
    }

    private void resolve(PluginCall call, boolean granted) {
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }
}
