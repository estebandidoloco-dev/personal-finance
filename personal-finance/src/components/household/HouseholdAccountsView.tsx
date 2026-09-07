'use client';

import { useState } from 'react';
import Link from 'next/link';
import { householdAccountSchema } from '@/lib/contracts/household';
import { useApiResource } from '@/hooks/use-api-resource';
import { MoneyAmount } from '@/components/dashboard/MoneyAmount';
import { accountTypeLabel } from '@/lib/household/presentation';
import { AsyncState } from '@/components/shell/AsyncState';
import { ErrorPanel } from '@/components/shell/ErrorPanel';
import { EmptyState } from '@/components/shell/EmptyState';
import { ConfirmDialog } from '@/components/shell/ConfirmDialog';
import { UsersRound } from 'lucide-react';

export function HouseholdAccountsView({
  householdId,
  readOnly = false,
}: {
  householdId: string;
  readOnly?: boolean;
}) {
  const [closing, setClosing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const resource = useApiResource(
    async (signal) => {
      const response = await fetch(`/api/household/accounts?household_id=${householdId}`, {
        signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error('No se pudieron cargar las cuentas comunes.');
      return householdAccountSchema.array().parse(payload);
    },
    householdId,
    (items) => items.length === 0
  );
  const close = async () => {
    if (!closing) return;
    setBusy(true);
    setError('');
    const response = await fetch(`/api/household/accounts/${closing}`, { method: 'DELETE' });
    if (!response.ok) {
      setError('No se pudo cerrar la cuenta común.');
      setBusy(false);
      return;
    }
    setClosing(null);
    setBusy(false);
    resource.retry();
  };
  return (
    <section className="min-w-0 space-y-4">
      {error && (
        <p role="alert" className="border-danger bg-danger-soft text-danger rounded-xl border p-3">
          {error}
        </p>
      )}
      {resource.status === 'loading' && <AsyncState label="Cargando fondos comunes…" />}
      {resource.status === 'error' && (
        <ErrorPanel message={resource.error} onRetry={resource.retry} />
      )}
      {resource.status === 'empty' && (
        <EmptyState
          title="No hay cuentas comunes"
          description="Los fondos comunes están separados de las cuentas personales."
        />
      )}
      {resource.status === 'success' && (
        <ul className="grid min-w-0 gap-4 md:grid-cols-2">
          {resource.data.map((account) => (
            <li key={account.id} className="bg-surface min-w-0 rounded-2xl border p-5">
              <div className="flex min-w-0 gap-3">
                <div className="flex min-w-0 gap-3">
                  <span className="bg-surface-subtle text-info flex size-10 shrink-0 items-center justify-center rounded-xl">
                    <UsersRound aria-hidden="true" className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="font-semibold break-words">{account.name}</h2>
                    <p className="text-text-muted text-sm">
                      Fondo común · {accountTypeLabel(account.type)} ·{' '}
                      {account.status === 'active' ? 'Activo' : 'Cerrado'}
                    </p>
                  </div>
                </div>
              </div>
              <p className="mt-5 text-xl font-bold">
                <MoneyAmount amount={account.balance} />
              </p>
              {!readOnly && account.status === 'active' && (
                <div className="mt-4 flex flex-wrap gap-4 text-sm">
                  <Link
                    href={`/dashboard/household/accounts/${account.id}`}
                    className="text-primary min-h-11 py-2 hover:underline"
                  >
                    Editar
                  </Link>
                  <button
                    onClick={() => setClosing(account.id)}
                    className="text-danger min-h-11 hover:underline"
                  >
                    Cerrar cuenta
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={closing !== null}
        title="Cerrar cuenta común"
        description="La cuenta conservará su historial y dejará de aceptar nuevas operaciones."
        confirmLabel="Cerrar cuenta"
        busy={busy}
        onConfirm={() => void close()}
        onClose={() => setClosing(null)}
      />
    </section>
  );
}
