'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSupabase } from '@/components/providers/supabase-provider';

const ACCOUNT_TYPES = [
  { value: 'checking', label: 'Cuenta corriente' },
  { value: 'savings', label: 'Ahorros' },
  { value: 'credit', label: 'Tarjeta de crédito' },
  { value: 'cash', label: 'Efectivo' },
  { value: 'investment', label: 'Inversión' },
  { value: 'other', label: 'Otro' },
] as const;

export default function NewAccountPage() {
  const { supabase } = useSupabase();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    name: '',
    type: 'checking',
    initial_balance: '0',
    currency: 'MXN',
    is_shared: false,
    institution: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? e.target.checked : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Obtener usuario actual
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError('No hay sesión activa');
      setLoading(false);
      return;
    }

    const { error } = await supabase.from('accounts').insert({
      name: form.name,
      type: form.type,
      initial_balance: parseFloat(form.initial_balance) || 0,
      currency: form.currency,
      is_shared: form.is_shared,
      institution: form.institution || null,
      user_id: user.id, // ← AÑADIR ESTO
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push('/dashboard');
      router.refresh();
    }
  };

  return (
    <div className="mx-auto max-w-xl p-6">
      <div className="mb-6">
        <a href="/dashboard" className="text-sm text-blue-600 hover:underline">
          ← Volver
        </a>
        <h1 className="mt-2 text-2xl font-bold">Nueva cuenta</h1>
      </div>

      {error && <div className="mb-4 rounded bg-red-100 p-3 text-sm text-red-700">{error}</div>}

      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-lg border bg-white p-6 dark:bg-gray-800"
      >
        <div>
          <label className="mb-1 block text-sm font-medium">Nombre *</label>
          <input
            type="text"
            name="name"
            value={form.name}
            onChange={handleChange}
            required
            placeholder="Ej: Santander Nómina, Efectivo, Revolut"
            className="w-full rounded-md border px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Tipo *</label>
          <select
            name="type"
            value={form.type}
            onChange={handleChange}
            className="w-full rounded-md border px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            {ACCOUNT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Saldo inicial</label>
          <input
            type="number"
            name="initial_balance"
            step="0.01"
            value={form.initial_balance}
            onChange={handleChange}
            className="w-full rounded-md border px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Moneda</label>
          <input
            type="text"
            name="currency"
            value={form.currency}
            onChange={handleChange}
            maxLength={3}
            className="w-full rounded-md border px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Institución (opcional)</label>
          <input
            type="text"
            name="institution"
            value={form.institution}
            onChange={handleChange}
            placeholder="Ej: BBVA, Santander, Revolut"
            className="w-full rounded-md border px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            name="is_shared"
            checked={form.is_shared}
            onChange={handleChange}
            id="is_shared"
            className="h-4 w-4"
          />
          <label htmlFor="is_shared" className="text-sm">
            Cuenta compartida (visible para ambos)
          </label>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-green-600 py-2 text-white hover:bg-green-700 disabled:opacity-50"
        >
          {loading ? 'Creando...' : 'Crear cuenta'}
        </button>
      </form>
    </div>
  );
}
