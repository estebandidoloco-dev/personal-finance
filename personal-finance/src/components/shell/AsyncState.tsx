export function AsyncState({ label = 'Cargando…' }: { label?: string }) {
  return <div role="status" aria-live="polite" className="rounded-2xl border bg-surface p-10 text-center text-text-muted"><span className="inline-block h-4 w-32 animate-pulse rounded bg-surface-subtle" /><span className="sr-only">{label}</span></div>;
}
