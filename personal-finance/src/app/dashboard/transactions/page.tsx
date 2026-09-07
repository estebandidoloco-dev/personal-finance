'use client';

import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { z } from 'zod';
import {
  personalAccountResponseSchema,
  personalTransactionResponseSchema,
} from '@/lib/validation/financial';
import { useApiResource } from '@/hooks/use-api-resource';
import {
  TransactionForm,
  type PersonalTransaction,
} from '@/components/transactions/TransactionForm';
import { MoneyAmount } from '@/components/dashboard/MoneyAmount';
import { formatFinancialDate } from '@/lib/dates/financial-date';
import { transactionStatusLabel } from '@/lib/household/presentation';
import { AsyncState } from '@/components/shell/AsyncState';
import { ErrorPanel } from '@/components/shell/ErrorPanel';
import { EmptyState } from '@/components/shell/EmptyState';
import { ContextBadge } from '@/components/shell/ContextBadge';
import { readApiError } from '@/lib/api-error';

const optionSchema = z
  .object({ id: z.string().uuid(), name: z.string(), type: z.string().optional() })
  .passthrough();
const emptyFilters = { start_date: '', end_date: '', account_id: '', category_id: '' };

export default function TransactionsPage() {
  const [filters, setFilters] = useState(emptyFilters);
  const [form, setForm] = useState<{
    transaction: PersonalTransaction | null;
    kind: 'income' | 'expense';
  } | null>(null);
  const [actionError, setActionError] = useState('');
  const [actionMenu, setActionMenu] = useState<string | null>(null);
  const key = JSON.stringify(filters);
  const resource = useApiResource(
    async (signal) => {
      const params = new URLSearchParams({ limit: '100', offset: '0' });
      Object.entries(filters).forEach(([name, value]) => {
        if (value) params.set(name, value);
      });
      const responses = await Promise.all([
        fetch(`/api/transactions?${params}`, { signal }),
        fetch('/api/accounts', { signal }),
        fetch('/api/categories', { signal }),
        fetch('/api/tags', { signal }),
      ]);
      const payloads: unknown[] = await Promise.all(responses.map((response) => response.json()));
      if (!responses.every((response) => response.ok))
        throw new Error('No se pudieron cargar los movimientos.');
      return {
        transactions: personalTransactionResponseSchema.array().parse(payloads[0]),
        accounts: personalAccountResponseSchema.array().parse(payloads[1]),
        categories: optionSchema.array().parse(payloads[2]),
        tags: optionSchema.array().parse(payloads[3]),
      };
    },
    key,
    (data) => data.transactions.length === 0
  );

  const remove = async (transaction: PersonalTransaction) => {
    if (!window.confirm(`¿Eliminar «${transaction.description}»?`)) return;
    setActionError('');
    const response = await fetch(`/api/transactions/${transaction.id}`, { method: 'DELETE' });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const api = readApiError(payload, 'No se pudo eliminar el movimiento.');
      setActionError(
        api.message.includes('Household') || api.message.includes('shared expense')
          ? 'Este movimiento pertenece a un gasto compartido. Elimínalo desde En pareja.'
          : api.message
      );
      return;
    }
    resource.retry();
  };

  const data = resource.status === 'success' || resource.status === 'empty' ? resource.data : null;
  const hasFilters = Object.values(filters).some(Boolean);
  return (
    <main className="w-full min-w-0 space-y-6">
      <header className="flex flex-col items-start gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <ContextBadge />
          <h1 className="mt-2 text-3xl font-bold break-words">Movimientos personales</h1>
        </div>
        <button
          onClick={() => setForm({ transaction: null, kind: 'expense' })}
          className="min-h-11 w-full rounded-xl bg-primary px-4 font-semibold text-on-primary hover:bg-primary-hover sm:w-auto"
        >
          Registrar movimiento
        </button>
      </header>
      {actionError && (
        <p role="alert" className="rounded-xl border border-danger bg-danger-soft p-3 text-danger">
          {actionError}
        </p>
      )}
      <section className="grid min-w-0 gap-3 rounded-2xl border bg-surface p-4 sm:grid-cols-2 xl:grid-cols-4">
        <label className="min-w-0 text-sm">
          Desde
          <input
            type="date"
            value={filters.start_date}
            onChange={(event) => setFilters({ ...filters, start_date: event.target.value })}
            className="mt-1 w-full min-w-0 bg-surface px-3"
          />
        </label>
        <label className="min-w-0 text-sm">
          Hasta
          <input
            type="date"
            value={filters.end_date}
            onChange={(event) => setFilters({ ...filters, end_date: event.target.value })}
            className="mt-1 w-full min-w-0 bg-surface px-3"
          />
        </label>
        <label className="min-w-0 text-sm">
          Cuenta
          <select
            value={filters.account_id}
            onChange={(event) => setFilters({ ...filters, account_id: event.target.value })}
            className="mt-1 w-full min-w-0 bg-surface px-3"
          >
            <option value="">Todas</option>
            {data?.accounts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-sm">
          Categoría
          <select
            value={filters.category_id}
            onChange={(event) => setFilters({ ...filters, category_id: event.target.value })}
            className="mt-1 w-full min-w-0 bg-surface px-3"
          >
            <option value="">Todas</option>
            {data?.categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </section>
      {data && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium">
            {data.transactions.length}{' '}
            {data.transactions.length === 1 ? 'movimiento' : 'movimientos'}
          </p>
          {hasFilters && (
            <button
              type="button"
              onClick={() => setFilters(emptyFilters)}
              className="min-h-11 rounded-xl border px-4 text-sm"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      )}
      {resource.status === 'loading' && <AsyncState label="Cargando movimientos…" />}
      {resource.status === 'error' && (
        <ErrorPanel message={resource.error} onRetry={resource.retry} />
      )}
      {resource.status === 'empty' && <EmptyState title="No hay movimientos" />}
      {resource.status === 'success' && (
        <ul className="grid min-w-0 gap-3">
          {resource.data.transactions.map((transaction) => {
            const account = resource.data.accounts.find(
              (item) => item.id === transaction.account_id
            );
            return (
              <li
                key={transaction.id}
                className="relative min-w-0 rounded-2xl border bg-surface p-4"
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold break-words">{transaction.description}</p>
                    <p className="mt-1 break-words text-sm text-text-muted">
                      {account?.name ?? 'Cuenta'} · {transaction.category?.name ?? 'Sin categoría'}{' '}
                      · {formatFinancialDate(transaction.date)}
                    </p>
                    <p className="mt-1 text-xs text-text-muted">
                      {transaction.kind === 'income' ? 'Ingreso' : 'Gasto'} ·{' '}
                      {transactionStatusLabel(transaction.status)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-start gap-1">
                    <span
                      className={`break-words font-semibold tabular-nums ${transaction.kind === 'income' ? 'text-income' : 'text-expense'}`}
                    >
                      <MoneyAmount amount={transaction.amount} sign={transaction.kind === 'income' ? 'positive' : 'negative'} />
                    </span>
                    <button
                      type="button"
                      aria-label={`Acciones para ${transaction.description}`}
                      aria-expanded={actionMenu === transaction.id}
                      onClick={() =>
                        setActionMenu((value) => (value === transaction.id ? null : transaction.id))
                      }
                      className="grid size-11 place-items-center rounded-xl hover:bg-surface-subtle"
                    >
                      <MoreHorizontal aria-hidden="true" className="size-5" />
                    </button>
                  </div>
                </div>
                {actionMenu === transaction.id && (
                  <div className="surface-enter absolute top-14 right-4 z-20 min-w-36 rounded-xl border bg-surface-raised p-1 shadow-lg">
                    <button
                      type="button"
                      onClick={() => {
                        setActionMenu(null);
                        setForm({ transaction, kind: transaction.kind });
                      }}
                      className="min-h-11 w-full rounded-lg px-3 text-left text-sm"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActionMenu(null);
                        void remove(transaction);
                      }}
                      className="min-h-11 w-full rounded-lg px-3 text-left text-sm text-danger hover:bg-danger-soft"
                    >
                      Eliminar
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {form && data && (
        <TransactionForm
          initialData={form.transaction}
          initialKind={form.kind}
          accounts={data.accounts}
          categories={data.categories}
          tags={data.tags}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            resource.retry();
          }}
        />
      )}
    </main>
  );
}
