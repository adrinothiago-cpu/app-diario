package com.thiago.diario;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.security.keystore.UserNotAuthenticatedException;
import android.util.Base64;
import androidx.annotation.NonNull;
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
import java.util.concurrent.Executor;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Desbloqueio do cofre por biometria (Android).
 *
 * Otimizado e corrigido para Samsung Galaxy (One UI 6/7 / Android 14/15/16),
 * incluindo o sensor ultrass\u00f4nico do Samsung Galaxy S25 Ultra.
 */
@CapacitorPlugin(name = "BiometricVault")
public class BiometricPlugin extends Plugin {

    private static final String KEY_ALIAS = "vault_biometric_key_v2";
    private static final String PREFS_NAME = "biometric_vault_prefs";
    private static final String PREF_SECRET = "encrypted_secret";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";

    @PluginMethod
    public void isAvailable(PluginCall call) {
        try {
            BiometricManager manager = BiometricManager.from(getContext());
            int result = manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);

            JSObject ret = new JSObject();
            boolean isAvailable = (result == BiometricManager.BIOMETRIC_SUCCESS);
            ret.put("available", isAvailable);
            ret.put("code", result);

            switch (result) {
                case BiometricManager.BIOMETRIC_SUCCESS:
                    ret.put("statusMessage", "Biometria forte disponivel e cadastrada.");
                    ret.put("hasHardware", true);
                    break;
                case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED:
                    ret.put("statusMessage", "Nenhuma digital cadastrada nas configuracoes do Android.");
                    ret.put("hasHardware", true);
                    break;
                case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE:
                    ret.put("statusMessage", "Aparelho nao possui leitor de digital.");
                    ret.put("hasHardware", false);
                    break;
                case BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE:
                    ret.put("statusMessage", "Sensor de digital temporariamente indisponivel.");
                    ret.put("hasHardware", true);
                    break;
                default:
                    ret.put("statusMessage", "Status biometrico: " + result);
                    ret.put("hasHardware", false);
                    break;
            }

            call.resolve(ret);
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("available", false);
            ret.put("code", -1);
            ret.put("statusMessage", "Erro ao verificar biometria: " + e.getMessage());
            call.resolve(ret);
        }
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
            call.reject("Segredo vazio.", "EMPTY_SECRET");
            return;
        }

        deleteKey();

        try {
            SecretKey key = generateNewKey();
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, key);

            authenticateOnMainThread(
                call,
                cipher,
                "Ativar biometria no Diario",
                "Toque no sensor para proteger o cofre",
                authenticatedCipher -> {
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
                        call.reject("Falha ao cifrar o segredo: " + e.getMessage(), "ENCRYPT_ERROR");
                    }
                }
            );
        } catch (KeyPermanentlyInvalidatedException e) {
            clearEnrollment();
            call.reject("Biometria do aparelho foi alterada. Tente cadastrar novamente.", "KEY_INVALIDATED");
        } catch (Exception e) {
            call.reject("Falha ao preparar chave biometrica: " + e.getMessage(), "KEY_PREPARE_ERROR");
        }
    }

    @PluginMethod
    public void unlock(PluginCall call) {
        String stored = prefs().getString(PREF_SECRET, null);
        if (stored == null) {
            call.reject("Nenhum segredo biometrico cadastrado.", "NO_SECRET_STORED");
            return;
        }

        String[] parts = stored.split(":", 2);
        if (parts.length < 2) {
            clearEnrollment();
            call.reject("Dados biometricos corrompidos. Reative com sua senha.", "CORRUPTED_SECRET");
            return;
        }

        try {
            byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
            byte[] ciphertext = Base64.decode(parts[1], Base64.NO_WRAP);

            SecretKey key = getKey();
            if (key == null) {
                clearEnrollment();
                call.reject("Chave biometrica nao encontrada no Keystore. Reative com sua senha.", "KEY_NOT_FOUND");
                return;
            }

            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));

            authenticateOnMainThread(
                call,
                cipher,
                "Desbloquear o Diario",
                "Toque no sensor de digital para continuar",
                authenticatedCipher -> {
                    try {
                        byte[] plain = authenticatedCipher.doFinal(ciphertext);
                        JSObject ret = new JSObject();
                        ret.put("secret", new String(plain, StandardCharsets.UTF_8));
                        call.resolve(ret);
                    } catch (Exception e) {
                        call.reject("Falha ao decifrar segredo biometrico.", "DECRYPT_ERROR");
                    }
                }
            );
        } catch (KeyPermanentlyInvalidatedException e) {
            clearEnrollment();
            call.reject("Biometria do aparelho mudou. Reative o desbloqueio com a senha.", "KEY_INVALIDATED");
        } catch (UserNotAuthenticatedException e) {
            call.reject("Autenticacao biometrica necessaria.", "USER_NOT_AUTHENTICATED");
        } catch (Exception e) {
            call.reject("Falha ao iniciar decifra biometrica: " + e.getMessage(), "DECRYPT_PREPARE_ERROR");
        }
    }

    @PluginMethod
    public void disable(PluginCall call) {
        clearEnrollment();
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    private interface CipherCallback {
        void onSuccess(Cipher cipher);
    }

    private void authenticateOnMainThread(
        PluginCall call,
        Cipher cipher,
        String title,
        String subtitle,
        CipherCallback onSuccess
    ) {
        FragmentActivity activity = (FragmentActivity) getActivity();
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) {
            call.reject("Janela do aplicativo nao esta ativa.", "ACTIVITY_UNAVAILABLE");
            return;
        }

        activity.runOnUiThread(() -> {
            try {
                Executor executor = ContextCompat.getMainExecutor(activity);

                BiometricPrompt prompt = new BiometricPrompt(
                    activity,
                    executor,
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                            super.onAuthenticationSucceeded(result);
                            BiometricPrompt.CryptoObject cryptoObject = result.getCryptoObject();
                            if (cryptoObject == null || cryptoObject.getCipher() == null) {
                                call.reject("Falha: CryptoObject nulo retornado pelo sistema.", "CRYPTO_NULL");
                                return;
                            }
                            onSuccess.onSuccess(cryptoObject.getCipher());
                        }

                        @Override
                        public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                            super.onAuthenticationError(errorCode, errString);
                            if (errorCode == BiometricPrompt.ERROR_USER_CANCELED ||
                                errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON) {
                                call.reject("Operacao cancelada pelo usuario.", "USER_CANCELED");
                            } else if (errorCode == BiometricPrompt.ERROR_LOCKOUT ||
                                       errorCode == BiometricPrompt.ERROR_LOCKOUT_PERMANENT) {
                                call.reject("Muitas tentativas incorretas. Sensor de digital bloqueado temporariamente.", "BIOMETRIC_LOCKOUT");
                            } else {
                                call.reject("Erro biometrico (" + errorCode + "): " + errString, "BIOMETRIC_ERROR_" + errorCode);
                            }
                        }

                        @Override
                        public void onAuthenticationFailed() {
                            super.onAuthenticationFailed();
                        }
                    }
                );

                BiometricPrompt.PromptInfo promptInfo = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title)
                    .setSubtitle(subtitle)
                    .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                    .setNegativeButtonText("Cancelar")
                    .build();

                prompt.authenticate(promptInfo, new BiometricPrompt.CryptoObject(cipher));
            } catch (Exception e) {
                call.reject("Erro ao abrir dialogo biometrico: " + e.getMessage(), "PROMPT_EXCEPTION");
            }
        });
    }

    private SecretKey generateNewKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            keyStore.deleteEntry(KEY_ALIAS);
        }

        KeyGenerator keyGenerator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore"
        );

        KeyGenParameterSpec.Builder builder = new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
            )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            builder.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        } else {
            builder.setUserAuthenticationValidityDurationSeconds(-1);
        }

        keyGenerator.init(builder.build());
        return keyGenerator.generateKey();
    }

    private SecretKey getKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (!keyStore.containsAlias(KEY_ALIAS)) {
            return null;
        }
        return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
    }

    private void deleteKey() {
        try {
            KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
            keyStore.load(null);
            if (keyStore.containsAlias(KEY_ALIAS)) {
                keyStore.deleteEntry(KEY_ALIAS);
            }
        } catch (Exception ignored) {
        }
    }

    private void clearEnrollment() {
        prefs().edit().remove(PREF_SECRET).apply();
        deleteKey();
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }
}
