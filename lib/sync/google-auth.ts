/**
 * Token de acesso ao Google Drive, escopo só `drive.appdata` (pasta oculta
 * deste app — nenhum outro arquivo do Drive fica visível). Sem backend e
 * sem script de terceiro:
 *
 * - Android: plugin nativo `GoogleDriveAuthPlugin.java` (login oficial do
 *   Google Play Services). O Google bloqueia login dentro de WebView, então
 *   não dá pra usar a página de login aqui. Depois do primeiro consentimento
 *   o token vem sem nenhuma tela (renovado pelo próprio sistema).
 * - PC (PWA): fluxo OAuth "token" numa janela. A página de retorno
 *   `public/oauth-callback.html` devolve o token por `BroadcastChannel` — não
 *   por `window.opener`, que a página de login do Google corta (COOP). O
 *   token fica só em memória (~1h); recarregar a página exige conectar de novo.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
/** Client ID OAuth do tipo "Aplicativo da Web" (não é segredo). */
export const GOOGLE_WEB_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "";
export const OAUTH_CHANNEL = "diario-oauth";
const LOGIN_TIMEOUT_MS = 5 * 60_000;

export class GoogleAuthError extends Error {}
/** Precisa de login com interação (clique do usuário) — não dá pra obter token em segundo plano. */
export class NeedsInteractionError extends GoogleAuthError {}

interface GoogleDriveAuthPluginInterface {
  authorize(options: { interactive: boolean }): Promise<{ accessToken: string }>;
}

const GoogleDriveAuth = registerPlugin<GoogleDriveAuthPluginInterface>("GoogleDriveAuth");

let cachedWebToken: { token: string; expiresAt: number } | null = null;

export function forgetDriveToken(): void {
  cachedWebToken = null;
}

export async function getDriveAccessToken(options: { interactive: boolean }): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { accessToken } = await GoogleDriveAuth.authorize({ interactive: options.interactive });
      return accessToken;
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.code === "NEEDS_INTERACTION") throw new NeedsInteractionError("Conecte ao Google para sincronizar.");
      throw new GoogleAuthError(e.message || "Falha no login do Google.");
    }
  }

  if (cachedWebToken && cachedWebToken.expiresAt > Date.now() + 60_000) return cachedWebToken.token;
  if (!options.interactive) throw new NeedsInteractionError("Conecte ao Google para sincronizar.");
  return loginWithPopup();
}

function loginWithPopup(): Promise<string> {
  if (!GOOGLE_WEB_CLIENT_ID) {
    return Promise.reject(
      new GoogleAuthError("Client ID do Google não configurado (NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID em .env.local)."),
    );
  }
  const state = crypto.randomUUID();
  const url =
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: GOOGLE_WEB_CLIENT_ID,
      redirect_uri: `${window.location.origin}/oauth-callback.html`,
      response_type: "token",
      scope: DRIVE_SCOPE,
      include_granted_scopes: "true",
      state,
    });

  // Aberta de forma síncrona no clique — senão o bloqueador de pop-up barra.
  const popup = window.open(url, "diario-google-login", "width=500,height=650");
  if (!popup) {
    return Promise.reject(new GoogleAuthError("O navegador bloqueou a janela de login — permita pop-ups para este site."));
  }

  return new Promise((resolve, reject) => {
    const channel = new BroadcastChannel(OAUTH_CHANNEL);
    // `popup.closed` não é confiável aqui (COOP do Google faz parecer fechada) — só timeout.
    const timer = setTimeout(() => {
      channel.close();
      reject(new GoogleAuthError("Login do Google não foi concluído."));
    }, LOGIN_TIMEOUT_MS);

    channel.onmessage = (ev: MessageEvent<{ hash?: string }>) => {
      const params = new URLSearchParams((ev.data?.hash ?? "").replace(/^#/, ""));
      if (params.get("state") !== state) return;
      clearTimeout(timer);
      channel.close();

      const error = params.get("error");
      if (error) {
        reject(new GoogleAuthError(error === "access_denied" ? "Login cancelado." : `Google recusou o login: ${error}`));
        return;
      }
      const token = params.get("access_token");
      if (!token) {
        reject(new GoogleAuthError("Google não devolveu o token de acesso."));
        return;
      }
      cachedWebToken = { token, expiresAt: Date.now() + Number(params.get("expires_in") ?? "3600") * 1000 };
      resolve(token);
    };
  });
}
