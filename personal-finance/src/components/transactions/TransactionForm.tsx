'use client';

import { useState } from 'react';
import { normalizeMoneyInput } from '@/lib/money/exact-money';
import { todayInMexicoCity } from '@/lib/dates/financial-date';
import { readApiError } from '@/lib/api-error';
import { ContextBadge } from '@/components/shell/ContextBadge';

type Option = { id: string; name: string; type?: string };
type Tag = { id: string; name: string };
export type PersonalTransaction = {
  id: string;
  account_id: string;
  category_id: string | null;
  kind: 'income' | 'expense';
  amount: string;
  date: string;
  description: string;
  notes: string | null;
  status: 'pending' | 'posted' | 'cancelled' | 'duplicate';
  is_shared: boolean | null;
  split_ratio: unknown;
  tags: Array<{ tag: Tag }>;
};

export function TransactionForm({
  initialData,
  initialKind = 'expense',
  accounts,
  categories,
  tags,
  onClose,
  onSaved,
}: {
  initialData?: PersonalTransaction | null;
  initialKind?: 'income' | 'expense';
  accounts: Option[];
  categories: Option[];
  tags: Tag[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(() =>
    initialData
      ? {
          account_id: initialData.account_id,
          category_id: initialData.category_id ?? '',
          kind: initialData.kind,
          amount: initialData.amount,
          date: initialData.date,
          description: initialData.description,
          notes: initialData.notes ?? '',
          status: initialData.status,
        }
      : {
          account_id: '',
          category_id: '',
          kind: initialKind,
          amount: '',
          date: todayInMexicoCity(),
          description: '',
          notes: '',
          status: 'posted',
        }
  );
  const [selectedTags, setSelectedTags] = useState<string[]>(
    () => initialData?.tags.map(({ tag }) => tag.id) ?? []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    const amount = normalizeMoneyInput(form.amount);
    if (!amount || amount === '0.00' || amount.startsWith('-')) {
      setError('El importe debe ser mayor que 0.00 y usar hasta dos decimales.');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(
        initialData ? `/api/transactions/${initialData.id}` : '/api/transactions',
        {
          method: initialData ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            account_id: form.account_id,
            category_id: form.category_id || null,
            kind: form.kind,
            amount,
            date: form.date,
            description: form.description,
            notes: form.notes.trim() || null,
            is_shared: initialData?.is_shared ?? false,
            split_ratio: initialData?.split_ratio ?? null,
            status: form.status,
            tag_ids: selectedTags,
          }),
        }
      );
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const api = readApiError(payload, 'No se pudo guardar el movimiento.');
        setError(
          api.message.includes('Household') || api.message.includes('shared expense')
            ? 'Este movimiento pertenece a un gasto compartido. Edítalo desde el espacio En pareja.'
            : api.message
        );
        return;
      }
      onSaved();
    } catch {
      setError('No se pudo conectar con el servidor.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="transaction-title"
      className="fixed inset-0 z-50 overflow-y-auto bg-text/55 p-4"
    >
      <div className="surface-enter mx-auto my-4 max-h-[calc(100dvh-2rem)] w-full max-w-2xl min-w-0 overflow-y-auto rounded-2xl border bg-surface-raised p-5 shadow-xl">
        <ContextBadge />
        <h2 id="transaction-title" className="mt-2 text-xl font-bold">
          {initialData ? 'Editar movimiento' : 'Registrar movimiento'}
        </h2>
        <form onSubmit={submit} className="mt-5 space-y-4">
          {error && (
            <p
              role="alert"
              aria-live="assertive"
              className="rounded-xl border border-danger bg-danger-soft p-3 text-sm text-danger"
            >
              {error}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">
              Cuenta
              <select
                required
                value={form.account_id}
                onChange={(e) => setForm({ ...form, account_id: e.target.value })}
                className="mt-1 w-full bg-surface px-3"
              >
                <option value="">Selecciona…</option>
                {accounts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              Tipo
              <select
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as 'income' | 'expense' })}
                className="mt-1 w-full bg-surface px-3"
              >
                <option value="expense">Gasto</option>
                <option value="income">Ingreso</option>
              </select>
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">
              Importe (MXN)
              <input
                required
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="0.00"
                className="mt-1 w-full bg-surface px-3 tabular-nums"
              />
            </label>
            <label className="text-sm font-medium">
              Fecha
              <input
                required
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
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
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="mt-1 w-full bg-surface px-3"
            />
          </label>
          <label className="block text-sm font-medium">
            Categoría
            <select
              value={form.category_id}
              onChange={(e) => setForm({ ...form, category_id: e.target.value })}
              className="mt-1 w-full bg-surface px-3"
            >
              <option value="">Sin categoría</option>
              {categories.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Estado
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              className="mt-1 w-full bg-surface px-3"
            >
              <option value="posted">Confirmado</option>
              <option value="pending">Pendiente</option>
              <option value="cancelled">Cancelado</option>
              <option value="duplicate">Duplicado</option>
            </select>
          </label>
          <label className="block text-sm font-medium">
            Notas
            <textarea
              maxLength={2000}
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="mt-1 w-full bg-surface p-3"
            />
          </label>
          <fieldset>
            <legend className="text-sm font-medium">Etiquetas</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {tags.map((tag) => (
                <label
                  key={tag.id}
                  className="flex min-h-11 items-center gap-2 rounded-full border px-3"
                >
                  <input
                    type="checkbox"
                    checked={selectedTags.includes(tag.id)}
                    onChange={(e) =>
                      setSelectedTags((current) =>
                        e.target.checked
                          ? [...current, tag.id]
                          : current.filter((id) => id !== tag.id)
                      )
                    }
                  />
                  {tag.name}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className="min-h-11 rounded-xl border px-4">
              Cancelar
            </button>
            <button
              disabled={saving}
              className="min-h-11 rounded-xl bg-primary px-5 font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50"
            >
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
