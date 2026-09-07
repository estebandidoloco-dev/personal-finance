export function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div role="alert" className="rounded-2xl border border-danger bg-danger-soft p-5 text-danger"><p className="font-semibold">No pudimos cargar esta información</p><p className="mt-1 text-sm">{message}</p>{onRetry && <button type="button" onClick={onRetry} className="mt-4 min-h-11 rounded-xl border border-danger bg-surface px-4 py-2 font-medium hover:bg-danger-soft">Reintentar</button>}</div>;
}
