"use client";

/**
 * Guias fixas no topo: `sticky` + mesma cor de fundo do body, sem
 * border/shadow — não existe linha separando a barra do conteúdo, ela some
 * visualmente contra o background enquanto a página rola por baixo.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Início" },
  { href: "/diario", label: "Diário" },
  { href: "/metricas", label: "Métricas" },
  { href: "/tarefas", label: "Tarefas" },
  { href: "/auditoria", label: "Auditoria" },
];

export function TopTabs() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-10 flex gap-1 bg-background px-4 py-3">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              active ? "bg-surface text-foreground" : "text-muted hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
