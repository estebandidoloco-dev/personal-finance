import Link from 'next/link';
import { ContextBadge } from '@/components/shell/ContextBadge';
import { householdStatusLabel } from '@/lib/household/presentation';

export function HouseholdHeader({
  name,
  status,
  writable = false,
}: {
  name: string;
  status: string;
  writable?: boolean;
}) {
  return (
    <header className="flex w-full min-w-0 flex-col items-start gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="hidden min-w-0 lg:block">
        <ContextBadge household />
        <h1 className="mt-2 text-3xl font-bold tracking-tight break-words">{name}</h1>
        <p className="text-text-muted mt-1">{householdStatusLabel(status)} · MXN</p>
      </div>
      {writable && (
        <div className="grid w-full gap-2 sm:flex sm:w-auto">
          <Link
            href="/dashboard/household/expenses/new"
            className="bg-primary text-on-primary hover:bg-primary-hover min-h-11 rounded-xl px-4 py-2.5 text-center font-semibold"
          >
            Registrar gasto
          </Link>
          <Link
            href="/dashboard/household/accounts/new"
            className="bg-surface hover:bg-surface-subtle min-h-11 rounded-xl border px-4 py-2.5 text-center font-semibold"
          >
            Crear fondo común
          </Link>
        </div>
      )}
    </header>
  );
}
