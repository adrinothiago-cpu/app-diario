"use client";

/**
 * Exibe a versão atual do app instalada no dispositivo.
 * No Android nativo, obtém dinamicamente via @capacitor/app (App.getInfo),
 * refletindo exatamente o versionName e versionCode do APK instalado.
 * Na web/desktop ou fallback, usa a versão do pacote.
 */
import { useEffect, useState } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

export const CURRENT_APP_VERSION = "1.8";
export const CURRENT_APP_BUILD = 14;

export function AppVersion({ className = "" }: { className?: string }) {
  const [versionText, setVersionText] = useState(`v${CURRENT_APP_VERSION}`);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      App.getInfo()
        .then((info) => {
          setVersionText(`v${info.version} (${info.build})`);
        })
        .catch(() => {
          // mantém o fallback se falhar
        });
    }
  }, []);

  return (
    <span
      title={`Versão ${CURRENT_APP_VERSION} (build ${CURRENT_APP_BUILD})`}
      className={`select-none text-[11px] font-mono text-muted/60 ${className}`}
    >
      {versionText}
    </span>
  );
}
