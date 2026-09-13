"use client";

import { useState } from "react";

export interface GeminiApiKeySettingsProps {
  currentKey: string | null;
  onSave: (key: string) => Promise<void>;
  label?: string;
}

export function GeminiApiKeySettings({
  currentKey,
  onSave,
  label,
}: GeminiApiKeySettingsProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);

  if (!open) {
    const defaultLabel = currentKey
      ? "Chave da Gemini API configurada — trocar"
      : "Configurar Gemini API";

    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-fit text-sm text-muted underline decoration-dotted underline-offset-4 hover:text-foreground"
      >
        {label ?? defaultLabel}
      </button>
    );
  }

  async function handleSave() {
    if (input.trim() === "") return;
    setSaving(true);
    try {
      await onSave(input.trim());
      setInput("");
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
      <p className="text-sm text-muted">
        A chave fica cifrada localmente (mesmo esquema do resto do cofre) e
        nunca sai do aparelho — só é usada para chamar a Gemini API quando
        você solicita uma ação (transcrição ou geração de insights). Gere a sua em{" "}
        <span className="select-all font-mono text-foreground">aistudio.google.com/apikey</span>.
      </p>
      <input
        type="password"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={currentKey ? "Nova chave (substitui a atual)" : "Cole sua chave aqui"}
        className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || input.trim() === ""}
          className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-background disabled:opacity-50"
        >
          {saving ? "Salvando…" : "Salvar"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium"
        >
          Cancelar
        </button>
      </div>
    </section>
  );
}
