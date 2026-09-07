'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import {
  householdAccountSchema,
  memberSchema,
  type HouseholdExpenseDetail,
} from '@/lib/contracts/household';
import { personalAccountResponseSchema } from '@/lib/validation/financial';
import { useApiResource } from '@/hooks/use-api-resource';
import { normalizeMoneyInput } from '@/lib/money/exact-money';
import { todayInMexicoCity } from '@/lib/dates/financial-date';
import { readApiError } from '@/lib/api-error';
import { SplitEditor, type SplitMode } from './SplitEditor';
import { validateCustomSplits, type SplitValue } from '@/lib/household/splits';
import { AsyncState } from '@/components/shell/AsyncState';
import { ErrorPanel } from '@/components/shell/ErrorPanel';

const categorySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    type: z.string(),
    user_id: z.string().uuid().nullable(),
  })
  .passthrough();
type FundingSource = 'personal_account' | 'household_account';

export function HouseholdExpenseForm({
  householdId,
  userId,
  detail,
  onSaved,
}: {
  householdId: string;
  userId: string;
  detail?: HouseholdExpenseDetail;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [fundingSource, setFundingSource] = useState<FundingSource>(
    detail?.funding_source ?? 'personal_account'
  );
  const [form, setForm] = useState({
    source_account_id: detail?.source_account_id ?? '',
    amount: detail?.amount ?? '',
    date: detail?.date ?? todayInMexicoCity(),
    description: detail?.description ?? '',
    category_id: detail?.category_id ?? '',
    notes: detail?.notes ?? '',
    status: detail?.status === 'pending' ? 'pending' : 'posted',
    split_mode: (detail?.split_mode ?? 'equal') as SplitMode,
  });
  const [customSplits, setCustomSplits] = useState<[SplitValue, SplitValue]>(
    (detail?.splits as [SplitValue, SplitValue]) ?? [
      { user_id: '', amount: '0.00' },
      { user_id: '', amount: '0.00' },
    ]
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const options = useApiResource(async (signal) => {
    const query = encodeURIComponent(householdId);
    const [membersResponse, personalResponse, commonResponse, categoryResponse] = await Promise.all(
      [
        fetch(`/api/household/members?household_id=${query}`, { signal }),
        fetch('/api/accounts', { signal }),
        fetch(`/api/household/accounts?household_id=${query}`, { signal }),
        fetch('/api/categories', { signal }),
      ]
    );
    const payloads: unknown[] = await Promise.all(
      [membersResponse, personalResponse, commonResponse, categoryResponse].map((response) =>
        response.json().catch(() => null)
      )
    );
    if (
      [membersResponse, personalResponse, commonResponse, categoryResponse].some(
        (response) => !response.ok
      )
    )
      throw new Error('No se pudieron cargar las opciones del gasto.');
    const members = memberSchema.array().length(2).parse(payloads[0]);
    const personal = personalAccountResponseSchema.array().parse(payloads[1]);
    const common = householdAccountSchema.array().parse(payloads[2]);
    const categories = categorySchema
      .array()
      .parse(payloads[3])
      .filter((category) => category.user_id === null && category.type === 'expense');
    return { members, personal, common, categories };
  }, householdId);

  if (options.status === 'loading') return <AsyncState label="Cargando opciones del gasto…" />;
  if (options.status === 'error')
    return <ErrorPanel message={options.error} onRetry={options.retry} />;
  const { members, personal, common, categories } = options.data;
  const memberIds = members.map((member) => member.user_id) as [string, string];
  const recorderId = detail?.recorded_by_user_id ?? userId;
  const residualUserId =
    fundingSource === 'personal_account' ? (detail?.personal_payer_user_id ?? userId) : recorderId;
  const total = normalizeMoneyInput(form.amount);
  const splits = memberIds.map(
    (id) => customSplits.find((split) => split.user_id === id) ?? { user_id: id, amount: '0.00' }
  ) as [SplitValue, SplitValue];
  const availableAccounts =
    fundingSource === 'personal_account'
      ? personal
      : common.filter(
          (account) => account.status === 'active' || account.id === detail?.source_account_id
        );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (!total || total === '0.00' || total.startsWith('-')) {
      setError('Escribe un importe mayor que 0.00 con hasta dos decimales.');
      return;
    }
    if (!form.source_account_id) {
      setError('Selecciona la cuenta de origen.');
      return;
    }
    const normalizedSplits =
      form.split_mode === 'custom'
        ? splits.map((split) => ({ ...split, amount: normalizeMoneyInput(split.amount) }))
        : null;
    if (normalizedSplits?.some((split) => split.amount === null)) {
      setError('Corrige los importes del reparto.');
      return;
    }
    if (normalizedSplits) {
      const splitError = validateCustomSplits(
        total,
        normalizedSplits as [SplitValue, SplitValue],
        memberIds
      );
      if (splitError) {
        setError(splitError);
        return;
      }
    }
    setBusy(true);
    try {
      const response = await fetch(
        detail ? `/api/household/expenses/${detail.id}` : '/api/household/expenses',
        {
          method: detail ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(detail ? {} : { household_id: householdId, funding_source: fundingSource }),
            source_account_id: form.source_account_id,
            amount: total,
            date: form.date,
            description: form.description,
            category_id: form.category_id || null,
            notes: form.notes.trim() || null,
            status: form.status,
            split_mode: form.split_mode,
            splits: normalizedSplits,
          }),
        }
      );
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(readApiError(payload, 'No se pudo guardar el gasto.').message);
        return;
      }
      window.dispatchEvent(
        new CustomEvent('household-finance-mutated', { detail: { householdId } })
      );
      if (detail) {
        onSaved?.();
        router.refresh();
      } else {
        const id =
          payload &&
          typeof payload === 'object' &&
          'id' in payload &&
          typeof payload.id === 'string'
            ? payload.id
            : null;
        router.push(id ? `/dashboard/household/expenses/${id}` : '/dashboard/household/expenses');
        router.refresh();
      }
    } catch {
      setError('No se pudo conectar con el servidor.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-5 rounded-2xl border bg-surface p-5 sm:p-6"
      aria-busy={busy}
    >
      {error && (
        <p
          role="alert"
          aria-live="assertive"
          className="rounded-xl border border-danger bg-danger-soft p-3 text-danger"
        >
          {error}
        </p>
      )}
      {detail ? (
        <div>
          <span className="text-sm font-medium">Origen de fondos</span>
          <p className="mt-1 rounded-xl bg-surface-subtle p-3">
            {fundingSource === 'personal_account' ? 'Cuenta personal' : 'Cuenta común'}{' '}
            <span className="text-sm text-text-muted">(no se puede cambiar)</span>
          </p>
        </div>
      ) : (
        <fieldset>
          <legend className="text-sm font-semibold">1. Origen de fondos</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {(
              [
                ['personal_account', 'Cuenta personal'],
                ['household_account', 'Cuenta común'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={fundingSource === value}
                onClick={() => {
                  setFundingSource(value);
                  setForm((current) => ({ ...current, source_account_id: '' }));
                }}
                className={`min-h-11 rounded-xl border px-4 ${fundingSource === value ? 'border-primary bg-primary-soft text-primary' : 'bg-surface hover:bg-surface-subtle'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <label className="block text-sm font-medium">
        2. Cuenta
        <select
          required
          value={form.source_account_id}
          onChange={(event) => setForm({ ...form, source_account_id: event.target.value })}
          className="mt-1 w-full bg-surface px-3"
        >
          <option value="">Seleccionar cuenta</option>
          {availableAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </label>
      {!availableAccounts.length && (
        <p role="alert" className="text-sm text-warning">
          No hay cuentas {fundingSource === 'personal_account' ? 'personales' : 'comunes activas'}{' '}
          disponibles.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">
          Importe (MXN)
          <input
            required
            inputMode="decimal"
            value={form.amount}
            onChange={(event) => setForm({ ...form, amount: event.target.value })}
            className="mt-1 w-full bg-surface px-3 tabular-nums"
          />
        </label>
        <label className="text-sm font-medium">
          Fecha
          <input
            required
            type="date"
            value={form.date}
            onChange={(event) => setForm({ ...form, date: event.target.value })}
            className="mt-1 w-full bg-surface px-3"
          />
        </label>
      </div>
      <label className="block text-sm font-medium">
        Descripción
        <input
          required
          maxLength={200}
          value={form.description}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
          className="mt-1 w-full bg-surface px-3"
        />
      </label>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">
          Categoría incluida (opcional)
          <select
            value={form.category_id}
            onChange={(event) => setForm({ ...form, category_id: event.target.value })}
            className="mt-1 w-full min-w-0 bg-surface px-3"
          >
            <option value="">Sin categoría</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          Estado
          <select
            value={form.status}
            onChange={(event) => setForm({ ...form, status: event.target.value })}
            className="mt-1 w-full min-w-0 bg-surface px-3"
          >
            <option value="posted">Confirmado</option>
            <option value="pending">Pendiente</option>
          </select>
        </label>
      </div>
      <label className="block text-sm font-medium">
        Notas (opcional)
        <textarea
          maxLength={2000}
          value={form.notes}
          onChange={(event) => setForm({ ...form, notes: event.target.value })}
          className="mt-1 min-h-24 w-full bg-surface p-3"
        />
      </label>
      {members.length === 2 && total && (
        <SplitEditor
          total={total}
          mode={form.split_mode}
          customSplits={splits}
          members={members}
          userId={userId}
          fundingSource={fundingSource}
          residualUserId={residualUserId}
          disabled={busy}
          onModeChange={(split_mode) => setForm({ ...form, split_mode })}
          onCustomChange={setCustomSplits}
        />
      )}
      <button
        disabled={busy || !availableAccounts.length}
        className="min-h-11 w-full rounded-xl bg-primary px-4 font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50"
      >
        {busy ? 'Guardando…' : detail ? 'Guardar cambios' : 'Crear gasto'}
      </button>
    </form>
  );
}
