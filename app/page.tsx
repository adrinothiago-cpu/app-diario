import Link from "next/link";
import { DevTag } from "@/components/dev-tag";

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
        <section className="rounded-xl border border-border bg-surface p-4">
          <h2 className="font-medium">Treino</h2>
          <p className="text-sm text-muted">Fichas e modo execução — em breve.</p>
        </section>
        <Link
          href="/diario"
          className="rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent"
        >
          <h2 className="font-medium">Diário</h2>
          <p className="text-sm text-muted">Entradas com texto, humor e voz.</p>
        </Link>
        <section className="rounded-xl border border-border bg-surface p-4">
          <h2 className="font-medium">Métricas</h2>
          <p className="text-sm text-muted">Visualizações de dados — em breve.</p>
        </section>
      </div>
    </main>
  );
}
