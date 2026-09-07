'use client';

import Link from 'next/link';
import { useHousehold } from '@/components/household/HouseholdContext';
import { ContextBadge } from '@/components/shell/ContextBadge';
import { EmptyState } from '@/components/shell/EmptyState';

export default function HouseholdArchivePage() {
  const { archives } = useHousehold();
  return (
    <main className="min-w-0 space-y-6">
      <header>
        <ContextBadge household />
        <h1 className="mt-2 text-3xl font-bold">Espacios anteriores</h1>
        <p className="text-text-muted mt-1">
          Consulta la información de espacios En pareja que ya cerraron.
        </p>
      </header>
      {!archives.length ? (
        <EmptyState title="No tienes espacios anteriores" />
      ) : (
        <ul className="grid min-w-0 gap-4 md:grid-cols-2">
          {archives.map((item) => (
            <li key={item.id} className="bg-surface min-w-0 rounded-2xl border p-5">
              <h2 className="font-semibold break-words">{item.name}</h2>
              <p className="text-text-muted mt-1 text-sm">
                Cerrado el{' '}
                {new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(
                  new Date(item.closed_at)
                )}
              </p>
              <Link
                href={`/dashboard/household/archive/${item.id}`}
                className="text-primary mt-4 inline-flex min-h-11 items-center hover:underline"
              >
                Ver historial
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
