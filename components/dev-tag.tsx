/**
 * Identificação discreta de componente, visível apenas em modo dev.
 * `select-all` permite copiar a referência exata com um clique.
 */
export function DevTag({ id }: { id: string }) {
  if (process.env.NODE_ENV !== "development") return null;
  return (
    <span className="select-all font-mono text-[10px] text-muted/60">{id}</span>
  );
}
