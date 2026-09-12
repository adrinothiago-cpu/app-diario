"use client";

import { useEffect, useState } from "react";
import { DevTag } from "@/components/dev-tag";
import { VaultGate } from "@/components/vault-gate";
import { useVault } from "@/components/vault-provider";
import { appendEvent, listDecryptedEvents } from "@/lib/events/event-store";
import type { DecryptedEvent, DiaryEntryEvent, WorkoutSetEvent } from "@/lib/events/types";

function isWorkout(event: DecryptedEvent): event is DecryptedEvent & WorkoutSetEvent {
  return event.type === "workout_set";
}

function isDiary(event: DecryptedEvent): event is DecryptedEvent & DiaryEntryEvent {
  return event.type === "diary_entry";
}

export default function AuditoriaPage() {
  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <DevTag id="app/auditoria/page.tsx#AuditoriaPage" />
      <h1 className="text-2xl font-semibold tracking-tight">Auditoria do cofre local</h1>
      <p className="max-w-2xl text-sm text-muted">
        Cada linha abaixo é um evento imutável decifrado em memória a partir do
        IndexedDB local. Nada aqui passa por rede — esta página só existe para
        você conferir, como tabela, exatamente o que está sendo gravado.
      </p>
      <VaultGate>
        <AuditoriaTables />
      </VaultGate>
    </main>
  );
}

function AuditoriaTables() {
  const { key } = useVault();
  const [events, setEvents] = useState<DecryptedEvent[]>([]);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    if (!key) return;
    setEvents(await listDecryptedEvents(key));
  }

  useEffect(() => {
    if (!key) return;
    listDecryptedEvents(key).then((decrypted) => setEvents(decrypted));
  }, [key]);

  async function handleAddWorkout() {
    if (!key) return;
    setBusy(true);
    try {
      const now = new Date();
      const event: WorkoutSetEvent = {
        type: "workout_set",
        Data: now.toISOString().slice(0, 10),
        Hora_Inicio: now.toTimeString().slice(0, 5),
        Hora_Fim: now.toTimeString().slice(0, 5),
        Etapa: "A",
        Exercicio: "Supino reto",
        Series: 4,
        Repeticoes: 8,
        Carga_kg: 60 + events.filter(isWorkout).length * 2.5,
        RPE: 8,
        Observacoes: "Evento de exemplo — gerado para auditoria.",
      };
      await appendEvent(key, event);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleAddDiary() {
    if (!key) return;
    setBusy(true);
    try {
      const now = new Date();
      const event: DiaryEntryEvent = {
        type: "diary_entry",
        Conteudo: "Entrada de exemplo gerada para auditoria.",
        Humor: 4,
        Horario: now.toTimeString().slice(0, 5),
        latitude: null,
        longitude: null,
        precisao: null,
      };
      await appendEvent(key, event);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const workoutEvents = events.filter(isWorkout);
  const diaryEvents = events.filter(isDiary);

  return (
    <>
      <div className="flex gap-3">
        <button
          onClick={handleAddWorkout}
          disabled={busy}
          className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          + Treino de exemplo
        </button>
        <button
          onClick={handleAddDiary}
          disabled={busy}
          className="rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          + Entrada de exemplo
        </button>
      </div>

      <EventTable
        title="Treino"
        events={workoutEvents}
        columns={[
          "id",
          "Data",
          "Hora_Inicio",
          "Hora_Fim",
          "Etapa",
          "Exercicio",
          "Series",
          "Repeticoes",
          "Carga_kg",
          "RPE",
          "Observacoes",
        ]}
      />

      <EventTable
        title="Diário"
        events={diaryEvents}
        columns={["id", "Horario", "Humor", "Conteudo", "latitude", "longitude", "precisao"]}
      />
    </>
  );
}

function EventTable<T extends { id: string }>({
  title,
  events,
  columns,
}: {
  title: string;
  events: T[];
  columns: (keyof T)[];
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">
        {title} <span className="text-muted">({events.length})</span>
      </h2>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-max text-left text-sm">
          <thead className="bg-surface text-muted">
            <tr>
              {columns.map((col) => (
                <th key={String(col)} className="whitespace-nowrap px-3 py-2 font-medium">
                  {String(col)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-3 text-muted">
                  Nenhum evento ainda.
                </td>
              </tr>
            ) : (
              events.map((event, i) => (
                <tr key={String(event.id ?? i)} className="border-t border-border">
                  {columns.map((col) => (
                    <td key={String(col)} className="whitespace-nowrap px-3 py-2">
                      {String(event[col] ?? "")}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
