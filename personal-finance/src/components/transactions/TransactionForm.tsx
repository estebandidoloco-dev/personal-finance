'use client';

import { useState, useEffect } from 'react';
import { useSupabase } from '@/components/providers/supabase-provider';
import { X } from 'lucide-react';
import { buildCategoryTree, flattenCategoryTree, type CategoryItem } from '@/lib/categories';

interface TransactionFormProps {
  onClose: () => void;
  onSuccess: () => void;
  defaultKind?: 'income' | 'expense';
  initialData?: {
    id: string;
    account_id?: string;
    category_id?: string;
    kind: 'income' | 'expense';
    amount?: number;
    currency?: string;
    date?: string;
    description?: string;
    notes?: string;
    is_shared?: boolean;
    status?: 'pending' | 'posted' | 'cancelled' | 'duplicate';
    tag_ids?: string[];
  };
}

export function TransactionForm({
  onClose,
  onSuccess,
  defaultKind = 'expense',
  initialData,
}: TransactionFormProps) {
  const { supabase } = useSupabase();
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string; type: string }>>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [tags, setTags] = useState<Array<{ id: string; name: string; color: string | null }>>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>(initialData?.tag_ids ?? []);
  const [metadataLoading, setMetadataLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    account_id: initialData?.account_id || '',
    category_id: initialData?.category_id || '',
    kind: initialData?.kind || defaultKind,
    amount: initialData?.amount ? String(initialData.amount) : '',
    currency: initialData?.currency || 'MXN',
    date: initialData?.date || new Date().toISOString().split('T')[0],
    description: initialData?.description || '',
    notes: initialData?.notes || '',
    is_shared: initialData?.is_shared || false,
    status: initialData?.status || 'posted',
  });

  useEffect(() => {
    async function loadMetadata() {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError || !user) {
        setError('Tu sesión no está disponible. Vuelve a iniciar sesión.');
        setMetadataLoading(false);
        return;
      }

      const [accRes, catRes, tagRes] = await Promise.all([
        supabase.from('accounts').select('id, name, type').eq('user_id', user.id).order('name'),
        supabase
          .from('categories')
          .select('id, parent_id, name, type, budget_type, icon, color, is_system, sort_order, user_id')
          .or(`user_id.is.null,user_id.eq.${user.id}`)
          .order('type')
          .order('sort_order'),
        supabase.from('tags').select('id, name, color').eq('user_id', user.id).order('name'),
      ]);

      if (accRes.error || catRes.error || tagRes.error) {
        setError('No se pudieron cargar las cuentas, categorías o etiquetas.');
        setMetadataLoading(false);
        return;
      }

      setAccounts(accRes.data ?? []);
      setCategories(
        (catRes.data ?? []).map((category) => ({
          ...category,
          is_system: category.is_system ?? false,
          sort_order: category.sort_order ?? 0,
        }))
      );
      setTags(tagRes.data ?? []);
      setMetadataLoading(false);
    }

    void loadMetadata();
  }, [supabase]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value, type } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  const handleTagToggle = (tagId: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const payload = {
      account_id: form.account_id,
      category_id: form.category_id || null,
      kind: form.kind,
      amount: parseFloat(form.amount),
      currency: form.currency,
      date: form.date,
      description: form.description,
      notes: form.notes || null,
      is_shared: form.is_shared,
      split_ratio: null,
      status: form.status,
      tag_ids: selectedTags,
    };

    if (!payload.account_id || isNaN(payload.amount) || !payload.date || !payload.description) {
      setError('Completa todos los campos requeridos');
      setLoading(false);
      return;
    }

    const url = initialData ? `/api/transactions/${initialData.id}` : '/api/transactions';
    try {
      const response = await fetch(url, {
        method: initialData ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(result?.error || 'No se pudo guardar la transacción');
        return;
      }

      onSuccess();
      onClose();
    } catch {
      setError('No se pudo conectar con el servidor. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const categoryOptions = flattenCategoryTree(
    buildCategoryTree(
      categories
    )
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-xl dark:bg-gray-800">
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="text-xl font-bold">{initialData ? 'Editar' : 'Nueva'} transacción</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          {error && <div className="rounded bg-red-100 p-3 text-sm text-red-700">{error}</div>}

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Cuenta *</label>
              <select
                name="account_id"
                value={form.account_id}
                onChange={handleChange}
                required
                className="w-full rounded-md border px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                <option value="">Seleccionar...</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.type})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Tipo *</label>
              <select
                name="kind"
                value={form.kind}
                onChange={handleChange}
                className="w-full rounded-md border px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                <option value="expense">Gasto</option>
                <option value="income">Ingreso</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Importe *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                name="amount"
                value={form.amount}
                onChange={handleChange}
                required
                placeholder="0.00"
                className="w-full rounded-md border px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Estado</label>
            <select
              name="status"
              value={form.status}
              onChange={handleChange}
              className="w-full rounded-md border px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              <option value="posted">Confirmada</option>
              <option value="pending">Pendiente</option>
              <option value="cancelled">Cancelada</option>
              <option value="duplicate">Duplicada</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Categoría</label>
            <select
              name="category_id"
              value={form.category_id}
              onChange={handleChange}
              className="w-full rounded-md border px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              <option value="">Sin categoría</option>
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id} style={{ color: c.color ?? undefined }}>
                  {'— '.repeat(c.depth)}{c.icon ? `${c.icon} ` : ''}{c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Fecha *</label>
              <input
                type="date"
                name="date"
                value={form.date}
                onChange={handleChange}
                required
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
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Descripción *</label>
            <input
              type="text"
              name="description"
              value={form.description}
              onChange={handleChange}
              required
              placeholder="Ej: Supermercado, Nómina, Suscripción Netflix"
              className="w-full rounded-md border px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Notas</label>
            <textarea
              name="notes"
              value={form.notes}
              onChange={handleChange}
              rows={2}
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
              Marcar como compartida (solo organizativo)
            </label>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Etiquetas</label>
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <button
                  type="button"
                  key={tag.id}
                  onClick={() => handleTagToggle(tag.id)}
                  className={`rounded-full border px-3 py-1 text-sm transition ${
                    selectedTags.includes(tag.id)
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-gray-300 bg-gray-100 dark:bg-gray-700'
                  }`}
                  style={{
                    backgroundColor: selectedTags.includes(tag.id)
                      ? tag.color || '#3b82f6'
                      : undefined,
                    borderColor: selectedTags.includes(tag.id) ? tag.color || '#3b82f6' : undefined,
                  }}
                >
                  {tag.name}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2 border-t pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 rounded border px-4 py-2 hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-700"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || metadataLoading}
              className="flex-1 rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
            >
              {metadataLoading
                ? 'Cargando datos...'
                : loading
                  ? 'Guardando...'
                  : initialData
                    ? 'Actualizar'
                    : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
