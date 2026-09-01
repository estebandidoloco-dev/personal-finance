'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const ACCOUNT_TYPES = [
  { value: 'checking', label: 'Cuenta corriente' },
  { value: 'savings', label: 'Ahorros' },
  { value: 'credit', label: 'Tarjeta de crédito' },
  { value: 'cash', label: 'Efectivo' },
  { value: 'investment', label: 'Inversión' },
  { value: 'other', label: 'Otro' },
] as const;

interface EditAccountButtonProps {
  account: {
    id: string;
    name: string;
    type: string;
    currency: string;
    institution: string | null;
    is_shared: boolean | null;
  };
}

export function EditAccountButton({ account }: EditAccountButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: account.name,
    type: account.type,
    currency: account.currency,
    institution: account.institution ?? '',
    is_shared: account.is_shared ?? false,
  });

  const openEditor = () => {
    setForm({
      name: account.name,
      type: account.type,
      currency: account.currency,
      institution: account.institution ?? '',
      is_shared: account.is_shared ?? false,
    });
    setError('');
    setOpen(true);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`/api/accounts/${account.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          currency: form.currency.toUpperCase(),
          institution: form.institution || null,
        }),
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(result?.error || 'No se pudo actualizar la cuenta');
        return;
      }

      setOpen(false);
      router.refresh();
    } catch {
      setError('No se pudo conectar con el servidor. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={openEditor} className="text-sm text-blue-600 hover:underline">
        Editar
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-4 rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800"
      >
        <h2 className="text-xl font-bold">Editar cuenta</h2>
        {error && <div className="rounded bg-red-100 p-3 text-sm text-red-700">{error}</div>}

        <label className="block text-sm font-medium">
          Nombre
          <input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            required
            maxLength={100}
            className="mt-1 w-full rounded-md border px-3 py-2"
          />
        </label>

        <label className="block text-sm font-medium">
          Tipo
          <select
            value={form.type}
            onChange={(event) => setForm({ ...form, type: event.target.value })}
            className="mt-1 w-full rounded-md border px-3 py-2"
          >
            {ACCOUNT_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm font-medium">
          Moneda
          <input
            value={form.currency}
            onChange={(event) => setForm({ ...form, currency: event.target.value })}
            required
            maxLength={3}
            className="mt-1 w-full rounded-md border px-3 py-2 uppercase"
          />
        </label>

        <label className="block text-sm font-medium">
          Institución
          <input
            value={form.institution}
            onChange={(event) => setForm({ ...form, institution: event.target.value })}
            maxLength={100}
            className="mt-1 w-full rounded-md border px-3 py-2"
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.is_shared}
            onChange={(event) => setForm({ ...form, is_shared: event.target.checked })}
          />
          Marcar como compartida
        </label>

        <p className="text-xs text-gray-500">
          El saldo inicial y el saldo actual no se pueden modificar después de crear la cuenta.
        </p>

        <div className="flex gap-2 border-t pt-4">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setError('');
            }}
            disabled={loading}
            className="flex-1 rounded border px-4 py-2"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
          >
            {loading ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  );
}
