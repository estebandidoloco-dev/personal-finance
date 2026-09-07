'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  expenseDetailSchema,
  householdAccountSchema,
  memberSchema,
} from '@/lib/contracts/household';
import { personalAccountResponseSchema } from '@/lib/validation/financial';
import { useApiResource } from '@/hooks/use-api-resource';
import { useHousehold } from '@/components/household/HouseholdContext';
import { HouseholdExpenseForm } from '@/components/household/HouseholdExpenseForm';
import { SplitPreview } from '@/components/household/SplitPreview';
import { ConfirmDialog } from '@/components/shell/ConfirmDialog';
import { AsyncState } from '@/components/shell/AsyncState';
import { ErrorPanel } from '@/components/shell/ErrorPanel';
import { ReadOnlyBanner } from '@/components/household/ReadOnlyBanner';
import { MoneyAmount } from '@/components/dashboard/MoneyAmount';
import { ContextBadge } from '@/components/shell/ContextBadge';
import { formatFinancialDate } from '@/lib/dates/financial-date';
import {
  getExpenseCategoryLabel,
  memberName,
  transactionStatusLabel,
} from '@/lib/household/presentation';
import { readApiError } from '@/lib/api-error';

export default function HouseholdExpenseDetailPage() {
  const id = useParams<{ id: string }>().id;
  const router = useRouter();
  const { current, archives, userId } = useHousehold();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [mutationError, setMutationError] = useState('');
  const resource = useApiResource(async (signal) => {
    const detailResponse = await fetch(`/api/household/expenses/${id}`, { signal });
    const detailPayload: unknown = await detailResponse.json().catch(() => null);
    if (!detailResponse.ok)
      throw new Error(readApiError(detailPayload, 'No se pudo cargar el gasto.').message);
    const detail = expenseDetailSchema.parse(detailPayload);
    const accountsUrl =
      detail.funding_source === 'household_account'
        ? `/api/household/accounts?household_id=${encodeURIComponent(detail.household_id)}`
        : '/api/accounts';
    const [membersResponse, accountsResponse] = await Promise.all([
      fetch(`/api/household/members?household_id=${encodeURIComponent(detail.household_id)}`, {
        signal,
      }),
      fetch(accountsUrl, { signal }),
    ]);
    const [membersPayload, accountsPayload]: unknown[] = await Promise.all([
      membersResponse.json().catch(() => null),
      accountsResponse.json().catch(() => null),
    ]);
    if (!membersResponse.ok || !accountsResponse.ok)
      throw new Error('No se pudieron cargar los datos relacionados del gasto.');
    const accounts =
      detail.funding_source === 'household_account'
        ? householdAccountSchema.array().parse(accountsPayload)
        : personalAccountResponseSchema.array().parse(accountsPayload);
    return {
      detail,
      members: memberSchema.array().length(2).parse(membersPayload),
      sourceName: accounts.find((account) => account.id === detail.source_account_id)?.name ?? null,
    };
  }, id);
  if (resource.status === 'loading') return <AsyncState label="Cargando detalle del gasto…" />;
  if (resource.status === 'error')
    return <ErrorPanel message={resource.error} onRetry={resource.retry} />;
  const { detail, members, sourceName } = resource.data;
  const archived =
    archives.some((item) => item.id === detail.household_id) ||
    current?.id !== detail.household_id ||
    current.status !== 'active';
  const canMutate =
    !archived &&
    (detail.funding_source === 'household_account' || detail.personal_payer_user_id === userId);
  const sourceLabel =
    detail.funding_source === 'personal_account' ? 'Cuenta personal' : 'Cuenta común';
  const remove = async () => {
    if (deleting) return;
    setDeleting(true);
    setMutationError('');
    try {
      const response = await fetch(`/api/household/expenses/${id}`, { method: 'DELETE' });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setMutationError(readApiError(payload, 'No se pudo eliminar el gasto.').message);
        return;
      }
      window.dispatchEvent(
        new CustomEvent('household-finance-mutated', {
          detail: { householdId: detail.household_id },
        })
      );
      router.replace('/dashboard/household/expenses');
      router.refresh();
    } catch {
      setMutationError('No se pudo conectar con el servidor.');
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  };
  if (editing && canMutate)
    return (
      <main className="mx-auto w-full max-w-2xl min-w-0 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold">Editar gasto</h1>
          <button className="min-h-11 rounded-xl border px-4" onClick={() => setEditing(false)}>
            Cancelar
          </button>
        </div>
        <HouseholdExpenseForm
          householdId={detail.household_id}
          userId={userId}
          detail={detail}
          onSaved={() => {
            setEditing(false);
            resource.retry();
          }}
        />
      </main>
    );
  return (
    <main className="mx-auto w-full max-w-3xl min-w-0 space-y-5">
      {archived && <ReadOnlyBanner />}
      <header>
        <ContextBadge household />
        <p className="text-primary text-sm font-semibold">{sourceLabel}</p>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold break-words">{detail.description}</h1>
            <p className="text-text-muted mt-1">
              {formatFinancialDate(detail.date)} · {transactionStatusLabel(detail.status)}
            </p>
          </div>
          <MoneyAmount amount={detail.amount} className="text-2xl font-bold" />
        </div>
      </header>
      {mutationError && <ErrorPanel message={mutationError} />}
      <section className="bg-surface grid min-w-0 gap-4 rounded-2xl border p-5 sm:grid-cols-2">
        <div>
          <p className="text-text-muted text-sm">Quién pagó y registró</p>
          <p className="font-medium">
            {memberName(
              members.find(
                (member) =>
                  member.user_id === (detail.personal_payer_user_id ?? detail.recorded_by_user_id)
              ),
              userId
            )}
          </p>
        </div>
        <div>
          <p className="text-text-muted text-sm">Cuenta de origen</p>
          <p className="font-medium break-words">
            {detail.source_account_id
              ? (sourceName ?? sourceLabel)
              : 'Información privada del pagador'}
          </p>
        </div>
        <div>
          <p className="text-text-muted text-sm">Categoría</p>
          <p className="font-medium">{getExpenseCategoryLabel(detail)}</p>
        </div>
        <div>
          <p className="text-text-muted text-sm">Notas</p>
          <p className="font-medium break-words whitespace-pre-wrap">
            {detail.notes ??
              (detail.funding_source === 'personal_account' &&
              detail.personal_payer_user_id !== userId
                ? 'Privadas del pagador'
                : 'Sin notas')}
          </p>
        </div>
      </section>
      <SplitPreview
        total={detail.amount}
        splits={detail.splits as [(typeof detail.splits)[number], (typeof detail.splits)[number]]}
        members={members}
        userId={userId}
        fundingSource={detail.funding_source}
        payerId={detail.personal_payer_user_id}
      />
      {canMutate && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            onClick={() => setEditing(true)}
            className="bg-primary text-on-primary hover:bg-primary-hover min-h-11 flex-1 rounded-xl px-4 font-semibold"
          >
            Editar gasto
          </button>
          <button
            onClick={() => setConfirming(true)}
            className="border-danger bg-danger-soft text-danger min-h-11 flex-1 rounded-xl border px-4 font-semibold"
          >
            Eliminar gasto
          </button>
        </div>
      )}
      {!canMutate && !archived && detail.funding_source === 'personal_account' && (
        <p className="bg-surface-subtle text-text-muted rounded-xl p-4 text-sm">
          Puedes consultar este gasto, pero sólo quien pagó con su cuenta personal puede editarlo o
          eliminarlo.
        </p>
      )}
      <Link
        href={
          archived
            ? `/dashboard/household/archive/${detail.household_id}`
            : '/dashboard/household/expenses'
        }
        className="text-primary inline-flex min-h-11 items-center hover:underline"
      >
        Volver
      </Link>
      <ConfirmDialog
        open={confirming}
        title="Eliminar gasto compartido"
        description="Esta acción elimina el gasto mediante la operación financiera autorizada y actualiza la cuenta de origen."
        confirmLabel="Eliminar gasto"
        busy={deleting}
        onConfirm={() => void remove()}
        onClose={() => setConfirming(false)}
      />
    </main>
  );
}
