"use client";

/**
 * Guias fixas no topo: `sticky` + mesma cor de fundo do body, sem
 * border/shadow — não existe linha separando a barra do conteúdo, ela some
 * visualmente contra o background enquanto a página rola por baixo.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppVersion } from "@/components/app-version";
import { useVault } from "@/components/vault-provider";

const TABS = [
  { href: "/", label: "Início" },
  { href: "/diario", label: "Diário" },
  { href: "/metricas", label: "Métricas" },
  { href: "/tarefas", label: "Tarefas" },
  { href: "/auditoria", label: "Auditoria" },
];

export function TopTabs() {
  const pathname = usePathname();
  const { key, lock } = useVault();

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
      <div className="ml-auto flex shrink-0 items-center gap-3 pl-2">
        {key && (
          <button
            type="button"
            onClick={lock}
            className="whitespace-nowrap text-sm text-muted hover:text-foreground"
          >
            Trancar
          </button>
        )}
        <AppVersion />
      </div>
    </nav>
  );
}
