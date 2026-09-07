'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Landmark, MoreHorizontal } from 'lucide-react';
import { personalAccountResponseSchema } from '@/lib/validation/financial';
import { useApiResource } from '@/hooks/use-api-resource';
import { MoneyAmount } from '@/components/dashboard/MoneyAmount';
import { accountTypeLabel } from '@/lib/household/presentation';
import { ContextBadge } from '@/components/shell/ContextBadge';
import { AsyncState } from '@/components/shell/AsyncState';
import { ErrorPanel } from '@/components/shell/ErrorPanel';
import { EmptyState } from '@/components/shell/EmptyState';
import { ConfirmDialog } from '@/components/shell/ConfirmDialog';
import { readApiError } from '@/lib/api-error';

type Account = ReturnType<typeof personalAccountResponseSchema.parse>;

export default function AccountsPage() {
  const router = useRouter();
  const [menuId, setMenuId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [success, setSuccess] = useState('');
  const resource = useApiResource(
    async (signal) => {
      const response = await fetch('/api/accounts', { signal });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error('No se pudieron cargar tus cuentas.');
      return personalAccountResponseSchema.array().parse(payload);
    },
    'personal-accounts',
    (accounts) => accounts.length === 0
  );

  const remove = async () => {
    if (!deleting || busy) return;
    setBusy(true);
    setActionError('');
    setSuccess('');
    try {
      const response = await fetch(`/api/accounts/${deleting.id}`, { method: 'DELETE' });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setActionError(
          response.status === 409
            ? 'No podemos eliminar esta cuenta mientras tenga movimientos asociados.'
            : readApiError(payload, 'No se pudo eliminar la cuenta. Inténtalo nuevamente.').message
        );
        return;
      }
      setDeleting(null);
      setSuccess('Cuenta eliminada');
      resource.retry();
      router.refresh();
    } catch {
      setActionError(
        'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo nuevamente.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-w-0 space-y-6">
      <header className="flex min-w-0 flex-col items-start gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <ContextBadge />
          <h1 className="mt-2 text-3xl font-bold">Cuentas personales</h1>
        </div>
        <Link
          href="/dashboard/accounts/new"
          className="bg-primary text-on-primary hover:bg-primary-hover min-h-11 w-full rounded-xl px-4 py-2.5 text-center font-semibold sm:w-auto"
        >
          Crear cuenta
        </Link>
      </header>
      {success && (
        <div
          role="status"
          aria-live="polite"
          className="surface-enter bg-success text-on-primary fixed top-20 right-4 z-40 rounded-xl px-4 py-3 text-sm font-semibold shadow-lg"
        >
          {success}
        </div>
      )}
      {actionError && (
        <div
          role="alert"
          className="border-danger bg-danger-soft text-danger rounded-xl border p-4"
        >
          <p className="font-semibold">No pudimos completar la acción</p>
          <p className="mt-1 text-sm">{actionError}</p>
        </div>
      )}
      {resource.status === 'loading' && <AsyncState label="Cargando cuentas…" />}
      {resource.status === 'error' && (
        <ErrorPanel message={resource.error} onRetry={resource.retry} />
      )}
      {resource.status === 'empty' && <EmptyState title="Aún no tienes cuentas" />}
      {resource.status === 'success' && (
        <ul className="grid min-w-0 gap-4 md:grid-cols-2">
          {resource.data.map((account) => (
            <li key={account.id} className="bg-surface relative min-w-0 rounded-2xl border p-5">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                  <span className="bg-surface-subtle text-text-muted grid size-10 shrink-0 place-items-center rounded-xl">
                    <Landmark aria-hidden="true" className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="font-semibold break-words">{account.name}</h2>
                    <p className="text-text-muted text-sm break-words">
                      {accountTypeLabel(account.type)}
                      {account.institution ? ` · ${account.institution}` : ''}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`Acciones para ${account.name}`}
                  aria-expanded={menuId === account.id}
                  onClick={() => setMenuId((value) => (value === account.id ? null : account.id))}
                  className="hover:bg-surface-subtle grid size-11 shrink-0 place-items-center rounded-xl"
                >
                  <MoreHorizontal aria-hidden="true" className="size-5" />
                </button>
              </div>
              <MoneyAmount
                amount={account.balance}
                className={`mt-5 block text-2xl font-bold break-words ${account.balance.startsWith('-') ? 'text-expense' : 'text-text'}`}
              />
              {menuId === account.id && (
                <div className="surface-enter bg-surface-raised absolute top-16 right-5 z-20 min-w-44 rounded-xl border p-1 shadow-lg">
                  <Link
                    href={`/dashboard/accounts/${account.id}`}
                    onClick={() => setMenuId(null)}
                    className="hover:bg-surface-subtle flex min-h-11 items-center rounded-lg px-3 text-sm"
                  >
                    Editar
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuId(null);
                      setDeleting(account);
                    }}
                    className="text-danger hover:bg-danger-soft min-h-11 w-full rounded-lg px-3 text-left text-sm"
                  >
                    Eliminar cuenta
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={deleting !== null}
        title="¿Eliminar esta cuenta?"
        description="Esta acción eliminará la cuenta de tu espacio personal. Si tiene movimientos o relaciones que impiden eliminarla, te avisaremos antes de realizar cambios."
        confirmLabel="Eliminar cuenta"
        busy={busy}
        onConfirm={() => void remove()}
        onClose={() => {
          if (!busy) setDeleting(null);
        }}
      />
    </main>
  );
}
