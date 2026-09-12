"use client";

/**
 * Banner fixo no topo avisando de atualização disponível — só verifica no
 * Android nativo (no PWA desktop não existe instalador para acionar, e
 * qualquer refresh do navegador já pega o build mais recente publicado).
 * Checagem acontece uma vez por abertura do app, sem repetir.
 */
import { useEffect, useState } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { downloadAndInstallUpdate } from "@/lib/native/updater";
import { checkForUpdate, type UpdateInfo } from "@/lib/update/check-update";

type Status = "idle" | "downloading" | "error";

export function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [needsSettings, setNeedsSettings] = useState(false);

  useEffect(() => {
    if (Capacitor.getPlatform() !== "android") return;
    App.getInfo()
      .then((info) => checkForUpdate(parseInt(info.build, 10)))
      .then((result) => {
        if (result?.available) setUpdate(result);
      });
  }, []);

  if (!update?.downloadUrl) return null;

  async function handleUpdate() {
    if (!update?.downloadUrl) return;
    setStatus("downloading");
    setNeedsSettings(false);
    try {
      const opened = await downloadAndInstallUpdate(update.downloadUrl);
      setNeedsSettings(opened === "settings");
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-3 bg-accent px-4 py-2 text-sm font-medium text-background">
      <span>Nova versão disponível: {update.latestVersionName}</span>
      <button
        onClick={handleUpdate}
        disabled={status === "downloading"}
        className="rounded-lg bg-background/20 px-3 py-1 disabled:opacity-60"
      >
        {status === "downloading" ? "Baixando…" : "Atualizar"}
      </button>
      {status === "error" && <span>Falha ao baixar — tente de novo mais tarde.</span>}
      {needsSettings && (
        <span>Habilite &quot;instalar apps desconhecidos&quot; para o Diário e toque em Atualizar de novo.</span>
      )}
    </div>
  );
}
