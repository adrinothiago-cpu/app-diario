"use client";

/**
 * Guias fixas no topo: `sticky` + mesma cor de fundo do body, sem
 * border/shadow — não existe linha separando a barra do conteúdo, ela some
 * visualmente contra o background enquanto a página rola por baixo.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppVersion } from "@/components/app-version";

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
    <nav className="sticky top-0 z-10 flex items-center gap-1 bg-background px-4 py-3">
      <div className="flex items-center gap-1 overflow-x-auto">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                active ? "bg-surface text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
      <div className="ml-auto flex shrink-0 items-center pl-2">
        <AppVersion />
      </div>
    </nav>
  );
}
