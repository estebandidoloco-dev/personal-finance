'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  pageSchema,
  type HouseholdActivity,
  type HouseholdMember,
} from '@/lib/contracts/household';
import { readApiError } from '@/lib/api-error';
import { formatFinancialDate } from '@/lib/dates/financial-date';
import { getExpenseCategoryLabel, memberName } from '@/lib/household/presentation';
import { MoneyAmount } from '@/components/dashboard/MoneyAmount';
import { transactionStatusLabel } from '@/lib/household/presentation';
import { AsyncState } from '@/components/shell/AsyncState';
import { ErrorPanel } from '@/components/shell/ErrorPanel';
import { EmptyState } from '@/components/shell/EmptyState';
import { ConfirmDialog } from '@/components/shell/ConfirmDialog';
import { Button } from '@/components/ui/button';

type Endpoint = 'expenses' | 'history';

export function HouseholdActivityList({
  householdId,
  endpoint,
  members = [],
  userId,
  limit = 25,
  readOnly = false,
  compact = false,
}: {
  householdId: string;
  endpoint: Endpoint;
  members?: HouseholdMember[];
  userId?: string;
  limit?: number;
  readOnly?: boolean;
  compact?: boolean;
}) {
  const [items, setItems] = useState<HouseholdActivity[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [retryNonce, setRetryNonce] = useState(0);
  const sequence = useRef(0);
  const activeController = useRef<AbortController | null>(null);
  const load = useCallback(
    async (nextCursor: string | null, append: boolean, signal: AbortSignal, request: number) => {
      if (append) setLoadingMore(true);
      else {
        setInitialLoading(true);
        setItems([]);
        setCursor(null);
      }
      setError('');
      try {
        const query = new URLSearchParams({ household_id: householdId, limit: String(limit) });
        if (nextCursor) query.set('cursor', nextCursor);
        const response = await fetch(`/api/household/${endpoint}?${query}`, { signal });
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok)
          throw new Error(readApiError(payload, 'No se pudo cargar la actividad.').message);
        const page = pageSchema.parse(payload);
        if (request !== sequence.current || signal.aborted) return;
        setItems((current) => {
          const source = append ? [...current, ...page.items] : page.items;
          const unique = new Map<string, HouseholdActivity>();
          source.forEach((item) => unique.set(`${item.entry_type}:${item.id}`, item));
          return Array.from(unique.values());
        });
        setCursor(page.next_cursor);
      } catch (caught) {
        if (!signal.aborted && request === sequence.current)
          setError(caught instanceof Error ? caught.message : 'No se pudo cargar la actividad.');
      } finally {
        if (!signal.aborted && request === sequence.current) {
          setInitialLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [endpoint, householdId, limit]
  );
  useEffect(() => {
    const controller = new AbortController();
    activeController.current = controller;
    const request = ++sequence.current;
    void load(null, false, controller.signal, request);
    return () => {
      controller.abort();
      if (activeController.current === controller) activeController.current = null;
      if (request === sequence.current) sequence.current += 1;
    };
  }, [load, retryNonce]);
  const loadMore = () => {
    if (!cursor || loadingMore) return;
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    const request = ++sequence.current;
    void load(cursor, true, controller.signal, request);
  };

  const [cancellingSettlementId, setCancellingSettlementId] = useState<string | null>(null);
  const [cancellingBusy, setCancellingBusy] = useState(false);
  const [cancelError, setCancelError] = useState('');

  const handleCancelSettlement = async () => {
    if (!cancellingSettlementId || cancellingBusy) return;
    setCancellingBusy(true);
    setCancelError('');
    try {
      const response = await fetch(`/api/household/settlements/${cancellingSettlementId}/cancel`, {
        method: 'POST',
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(readApiError(payload, 'No se pudo cancelar la liquidación.').message);
      }
      setItems((current) =>
        current.map((act) =>
          act.entry_type === 'settlement' && act.id === cancellingSettlementId
            ? { ...act, is_cancelled: true }
            : act
        )
      );
      window.dispatchEvent(
        new CustomEvent('household-finance-mutated', {
          detail: { householdId },
        })
      );
      setCancellingSettlementId(null);
    } catch (caught) {
      setCancelError(
        caught instanceof Error ? caught.message : 'No se pudo cancelar la liquidación.'
      );
    } finally {
      setCancellingBusy(false);
    }
  };
  if (initialLoading)
    return (
      <AsyncState
        label={endpoint === 'expenses' ? 'Cargando gastos compartidos…' : 'Cargando historial…'}
      />
    );
  if (error && !items.length)
    return <ErrorPanel message={error} onRetry={() => setRetryNonce((value) => value + 1)} />;
  if (!items.length)
    return (
      <EmptyState
        title={endpoint === 'expenses' ? 'Aún no hay gastos compartidos' : 'Aún no hay actividad'}
        description={
          readOnly
            ? 'Este archivo no contiene registros.'
            : 'Los movimientos aparecerán aquí cuando se registren.'
        }
      />
    );
  return (
    <div className="space-y-4">
      <ul className={`grid gap-3 ${compact ? '' : 'md:grid-cols-2'}`}>
        {items.map((item) => {
          if (item.entry_type === 'settlement') {
            const payerMember = members.find((member) => member.user_id === item.payer_user_id);
            const payeeMember = members.find((member) => member.user_id === item.payee_user_id);
            const payer = memberName(payerMember, userId);
            const payee = memberName(payeeMember, userId);
            const youArePayer = item.payer_user_id === userId;
            const youArePayee = item.payee_user_id === userId;
            const settlementLabel = youArePayer
              ? `Liquidaste a ${payee}`
              : youArePayee
                ? `${payer} te liquidó`
                : `${payer} liquidó a ${payee}`;

            return (
              <li
                key={`${item.entry_type}:${item.id}`}
                className="bg-surface w-full min-w-0 rounded-2xl border p-4"
              >
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold break-words">{settlementLabel}</p>
                    <p className="text-text-muted mt-1 text-sm">
                      {formatFinancialDate(item.date)} · {item.is_cancelled ? 'Cancelada' : 'Liquidación'}
                    </p>
                  </div>
                  <MoneyAmount amount={item.amount} className="text-base font-bold" />
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span
                    className={`rounded-full px-2 py-1 ${
                      item.is_cancelled ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'
                    }`}
                  >
                    {item.is_cancelled ? 'Liquidación cancelada' : 'Liquidación completada'}
                  </span>
                  {!item.is_cancelled && !readOnly && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="text-danger hover:bg-danger-soft hover:text-danger h-7 px-2 text-xs font-semibold"
                      onClick={() => {
                        setCancelError('');
                        setCancellingSettlementId(item.id);
                      }}
                    >
                      Cancelar liquidación
                    </Button>
                  )}
                </div>
                {item.notes && (
                  <p className="text-text-muted mt-2 text-xs break-words">
                    {item.notes}
                  </p>
                )}
              </li>
            );
          }

          const actorId = item.personal_payer_user_id ?? item.recorded_by_user_id;
          const actor = memberName(
            members.find((member) => member.user_id === actorId),
            userId
          );
          const paymentCopy =
            item.funding_source === 'household_account'
              ? 'Se pagó con fondos comunes'
              : item.personal_payer_user_id === userId
                ? 'Lo pagaste tú'
                : `Lo pagó ${actor}`;
          const content = (
            <>
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold break-words">{item.description}</p>
                  <p className="text-text-muted mt-1 text-sm">
                    {formatFinancialDate(item.date)} · {transactionStatusLabel(item.status)}
                  </p>
                </div>
                <MoneyAmount amount={item.amount} className="text-base font-bold" />
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="bg-info-soft text-info rounded-full px-2 py-1">
                  {item.entry_type === 'shared_expense'
                    ? paymentCopy
                    : item.kind === 'income'
                      ? 'Ingreso común'
                      : 'Movimiento común'}
                </span>
                {endpoint === 'history' && item.entry_type === 'household_transaction' && (
                  <span className="bg-surface-subtle text-text-muted rounded-full px-2 py-1">
                    Registró {actor}
                  </span>
                )}
              </div>
              {item.splits && (
                <div className="mt-3 grid gap-1 text-sm">
                  {item.splits.map((split) => {
                    const splitMember = members.find((member) => member.user_id === split.user_id);
                    const mine = split.user_id === userId;
                    return (
                      <p key={split.user_id} className="text-text-muted">
                        {mine ? 'Tu parte' : `Parte de ${memberName(splitMember)}`}:{' '}
                        <MoneyAmount amount={split.amount} />
                      </p>
                    );
                  })}
                </div>
              )}
            </>
          );
          return (
            <li
              key={`${item.entry_type}:${item.id}`}
              className="bg-surface w-full min-w-0 rounded-2xl border p-4"
            >
              {item.entry_type === 'shared_expense' ? (
                <Link
                  className="focus-visible:outline-focus-ring block min-w-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4"
                  href={`/dashboard/household/expenses/${item.household_expense_id}`}
                >
                  {content}
                  <p className="text-text-muted mt-2 text-xs">
                    Categoría: {getExpenseCategoryLabel(item)}
                  </p>
                </Link>
              ) : (
                content
              )}
            </li>
          );
        })}
      </ul>
      {error && <ErrorPanel message={error} onRetry={loadMore} />}
      {cursor ? (
        <button
          type="button"
          disabled={loadingMore}
          onClick={loadMore}
          className="bg-surface hover:bg-surface-subtle min-h-11 w-full rounded-xl border px-4 font-semibold"
        >
          {loadingMore ? 'Cargando…' : 'Cargar más'}
        </button>
      ) : (
        <p role="status" className="text-text-muted text-center text-sm">
          Fin del historial
        </p>
      )}
      <ConfirmDialog
        open={Boolean(cancellingSettlementId)}
        title="¿Cancelar esta liquidación?"
        description="Esta acción revertirá la liquidación y la deuda pendiente volverá a figurar en el balance entre ustedes."
        confirmLabel="Cancelar liquidación"
        busy={cancellingBusy}
        error={cancelError}
        onConfirm={() => void handleCancelSettlement()}
        onClose={() => {
          if (!cancellingBusy) {
            setCancellingSettlementId(null);
            setCancelError('');
          }
        }}
      />
    </div>
  );
}
