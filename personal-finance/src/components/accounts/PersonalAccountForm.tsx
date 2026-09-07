'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { normalizeMoneyInput } from '@/lib/money/exact-money';
import { readApiError } from '@/lib/api-error';

const TYPES = [
  ['checking', 'Cuenta corriente'],
  ['savings', 'Ahorro'],
  ['credit', 'Crédito'],
  ['cash', 'Efectivo'],
  ['investment', 'Inversión'],
  ['other', 'Otra'],
] as const;

export function PersonalAccountForm({
  account,
}: {
  account?: { id: string; name: string; type: string; institution: string | null };
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: account?.name ?? '',
    type: account?.type ?? 'checking',
    initial_balance: '0.00',
    institution: account?.institution ?? '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    const initial = account ? null : normalizeMoneyInput(form.initial_balance);
    if (!account && !initial) {
      setError('Escribe un importe válido, por ejemplo 1250.00.');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(account ? `/api/accounts/${account.id}` : '/api/accounts', {
        method: account ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          account
            ? { name: form.name, type: form.type, institution: form.institution.trim() || null }
            : {
                name: form.name,
                type: form.type,
                initial_balance: initial,
                is_shared: false,
                institution: form.institution.trim() || null,
              }
        ),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(readApiError(payload, 'No se pudo guardar la cuenta.').message);
        return;
      }
      router.push('/dashboard/accounts');
      router.refresh();
    } catch {
      setError('No se pudo conectar con el servidor.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <form onSubmit={submit} className="bg-surface space-y-5 rounded-2xl border p-5 sm:p-6">
      {error && (
        <div
          role="alert"
          className="border-danger bg-danger-soft text-danger rounded-xl border p-3 text-sm"
        >
          <p className="font-semibold">Revisa la información</p>
          <p className="mt-1">{error}</p>
        </div>
      )}
      <label className="block text-sm font-medium">
        Nombre
        <input
          required
          maxLength={100}
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          className="bg-surface mt-1 w-full px-3"
        />
      </label>
      <label className="block text-sm font-medium">
        Tipo
        <select
          value={form.type}
          onChange={(event) => setForm({ ...form, type: event.target.value })}
          className="bg-surface mt-1 w-full px-3"
        >
          {TYPES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {!account && (
        <label className="block text-sm font-medium">
          Saldo inicial (MXN)
          <input
            required
            inputMode="decimal"
            value={form.initial_balance}
            onChange={(event) => setForm({ ...form, initial_balance: event.target.value })}
            placeholder="0.00"
            className="bg-surface mt-1 w-full px-3 tabular-nums"
          />
          <span className="text-text-muted mt-1 block text-xs">
            El dinero que ya tenía esta cuenta antes de empezar a usar la app.
          </span>
        </label>
      )}
      <label className="block text-sm font-medium">
        Institución (opcional)
        <input
          maxLength={100}
          value={form.institution}
          onChange={(event) => setForm({ ...form, institution: event.target.value })}
          className="bg-surface mt-1 w-full px-3"
        />
      </label>
      <button
        disabled={saving}
        className="bg-primary text-on-primary hover:bg-primary-hover min-h-11 w-full rounded-xl px-4 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? 'Guardando…' : account ? 'Guardar cambios' : 'Crear cuenta personal'}
      </button>
    </form>
  );
}
