import type { ReactNode } from 'react';

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="rounded-2xl border border-dashed bg-surface p-8 text-center"><h2 className="font-semibold">{title}</h2>{description && <p className="mx-auto mt-2 max-w-xl text-sm text-text-muted">{description}</p>}{action && <div className="mt-5">{action}</div>}</div>;
}
