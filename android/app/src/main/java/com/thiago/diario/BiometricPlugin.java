package com.thiago.diario;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Desbloqueio do cofre por biometria. A SENHA do vault (não a chave AES
 * derivada, que nunca é extraível) fica cifrada em SharedPreferences
 * privado do app; quem cifra/decifra é uma chave AES-GCM que mora só no
 * Android Keystore, marcada `setUserAuthenticationRequired` — o sistema só
 * libera essa chave depois de um `BiometricPrompt` bem-sucedido, e ela nunca
 * sai do hardware seguro do aparelho (nem por root, sem exploit de
 * TEE/StrongBox). `setInvalidatedByBiometricEnrollment` derruba a chave se
 * uma digital nova for cadastrada no aparelho, forçando reativação manual
 * com a senha — evita que uma digital cadastrada depois (de outra pessoa)
 * destranque o cofre de quem ativou o recurso.
 */
@CapacitorPlugin(name = "BiometricVault")
public class BiometricPlugin extends Plugin {

    private static final String KEY_ALIAS = "vault_biometric_key";
    private static final String PREFS_NAME = "biometric_vault_prefs";
    private static final String PREF_SECRET = "encrypted_secret";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";

    @PluginMethod
    public void isAvailable(PluginCall call) {
        BiometricManager manager = BiometricManager.from(getContext());
        int result = manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        JSObject ret = new JSObject();
        ret.put("available", result == BiometricManager.BIOMETRIC_SUCCESS);
        call.resolve(ret);
    }

    @PluginMethod
    public void hasEnrolledSecret(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("enrolled", prefs().contains(PREF_SECRET));
        call.resolve(ret);
    }

    @PluginMethod
    public void enroll(PluginCall call) {
        String secret = call.getString("secret");
        if (secret == null || secret.isEmpty()) {
            call.reject("Segredo vazio.");
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
            authenticate(call, cipher, authenticatedCipher -> {
                try {
                    byte[] ciphertext = authenticatedCipher.doFinal(secret.getBytes(StandardCharsets.UTF_8));
                    byte[] iv = authenticatedCipher.getIV();
                    String encoded = Base64.encodeToString(iv, Base64.NO_WRAP)
                        + ":" + Base64.encodeToString(ciphertext, Base64.NO_WRAP);
                    prefs().edit().putString(PREF_SECRET, encoded).apply();
                    JSObject ret = new JSObject();
                    ret.put("ok", true);
                    call.resolve(ret);
                } catch (Exception e) {
                    call.reject("Falha ao cifrar o segredo: " + e.getMessage());
                }
            });
        } catch (KeyPermanentlyInvalidatedException e) {
            clearEnrollment();
            call.reject("Biometria do aparelho mudou — tente ativar de novo.");
        } catch (Exception e) {
            call.reject("Falha ao preparar chave biométrica: " + e.getMessage());
        }
    }

    @PluginMethod
    public void unlock(PluginCall call) {
        String stored = prefs().getString(PREF_SECRET, null);
        if (stored == null) {
            call.reject("Nenhum segredo cadastrado.");
            return;
        }
        String[] parts = stored.split(":", 2);
        try {
            byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
            byte[] ciphertext = Base64.decode(parts[1], Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(128, iv));
            authenticate(call, cipher, authenticatedCipher -> {
                try {
                    byte[] plain = authenticatedCipher.doFinal(ciphertext);
                    JSObject ret = new JSObject();
                    ret.put("secret", new String(plain, StandardCharsets.UTF_8));
                    call.resolve(ret);
                } catch (Exception e) {
                    call.reject("Falha ao decifrar — reative o desbloqueio por digital.");
                }
            });
        } catch (KeyPermanentlyInvalidatedException e) {
            clearEnrollment();
            call.reject("Biometria do aparelho mudou — reative o desbloqueio por digital com a senha.");
        } catch (Exception e) {
            call.reject("Falha ao preparar decifra: " + e.getMessage());
        }
    }

    @PluginMethod
    public void disable(PluginCall call) {
        clearEnrollment();
        call.resolve();
    }

    private interface CipherCallback {
        void onSuccess(Cipher cipher);
    }

    private void authenticate(PluginCall call, Cipher cipher, CipherCallback onSuccess) {
        FragmentActivity activity = (FragmentActivity) getActivity();
        BiometricPrompt prompt = new BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(getContext()),
            new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                    onSuccess.onSuccess(result.getCryptoObject().getCipher());
                }

                @Override
                public void onAuthenticationError(int errorCode, CharSequence errString) {
                    call.reject("Autenticação biométrica cancelada: " + errString);
                }

                @Override
                public void onAuthenticationFailed() {
                    // Impressão não reconhecida — o próprio BiometricPrompt deixa tentar de novo.
                }
            }
        );

        BiometricPrompt.PromptInfo promptInfo = new BiometricPrompt.PromptInfo.Builder()
            .setTitle("Desbloquear o Diário")
            .setSubtitle("Use sua digital para continuar")
            .setNegativeButtonText("Cancelar")
            .build();

        activity.runOnUiThread(() -> prompt.authenticate(promptInfo, new BiometricPrompt.CryptoObject(cipher)));
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
        }
        KeyGenerator keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
            )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)
            .build();
        keyGenerator.init(spec);
        return keyGenerator.generateKey();
    }

    private void clearEnrollment() {
        prefs().edit().remove(PREF_SECRET).apply();
        try {
            KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            if (keyStore.containsAlias(KEY_ALIAS)) {
                keyStore.deleteEntry(KEY_ALIAS);
            }
        } catch (Exception e) {
            // Segue mesmo se a limpeza da chave falhar — o segredo cifrado já foi removido.
        }
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }
}
