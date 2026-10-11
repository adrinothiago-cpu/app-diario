import Link from "next/link";
import { AppVersion } from "@/components/app-version";
import { DevTag } from "@/components/dev-tag";
import { SyncPanel } from "@/components/sync-panel";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <DevTag id="app/page.tsx#Home" />
      <h1 className="text-3xl font-semibold tracking-tight">Diário</h1>
      <p className="max-w-md text-center text-muted">
        Diário pessoal e tracker de treino. Offline-first, criptografado ponta
        a ponta. Base do projeto configurada — módulos em construção.
      </p>
      <div className="grid w-full max-w-md gap-3">
        <SyncPanel />
        <Link
          href="/treino"
          className="rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent"
        >
          <h2 className="font-medium">Treino</h2>
          <p className="text-sm text-muted">Rodízio ABC e acompanhamento com IA.</p>
        </Link>
        <Link
          href="/diario"
          className="rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent"
        >
          <h2 className="font-medium">Diário</h2>
          <p className="text-sm text-muted">Entradas com texto, humor e voz.</p>
        </Link>
        <Link
          href="/metricas"
          className="rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent"
        >
          <h2 className="font-medium">Métricas</h2>
          <p className="text-sm text-muted">Insights e evolução do humor com Gemini.</p>
        </Link>
        <Link
          href="/evolucao"
          className="rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent"
        >
          <h2 className="font-medium">Evolução</h2>
          <p className="text-sm text-muted">Acompanhamento e reflexões com IA.</p>
        </Link>
        <Link
          href="/tarefas"
          className="rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent"
        >
          <h2 className="font-medium">Tarefas</h2>
          <p className="text-sm text-muted">Tarefas com sugestões e estimativas.</p>
        </Link>
        <Link
          href="/compras"
          className="rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent"
        >
          <h2 className="font-medium">Compras</h2>
          <p className="text-sm text-muted">Listas de compras e pesquisa de preços.</p>
        </Link>
      </div>
      <footer className="mt-2 text-center text-xs text-muted/50">
        <span>Diário App • </span>
        <AppVersion />
      </footer>
    </main>
  );
}
