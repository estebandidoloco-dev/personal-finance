'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { ContextBadge } from '@/components/shell/ContextBadge';
import {
  buildCategoryTree,
  flattenCategoryTree,
  getCategoryDescendantIds,
  type CategoryItem,
} from '@/lib/categories';
import { readApiError } from '@/lib/api-error';
import { CategoryIcon } from '@/components/ui/CategoryIcon';
import { CATEGORY_ICON_OPTIONS, resolveCategoryIconKey } from '@/lib/ui/category-icon';

interface CategoryFormProps {
  categories: CategoryItem[];
  initialCategory?: CategoryItem;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function CategoryForm({ categories, initialCategory, onClose, onSaved }: CategoryFormProps) {
  const [form, setForm] = useState({
    name: initialCategory?.name ?? '',
    parent_id: initialCategory?.parent_id ?? '',
    type: initialCategory?.type ?? 'expense',
    budget_type: initialCategory?.budget_type ?? '',
    icon: initialCategory?.icon ?? '',
    color: initialCategory?.color ?? '#64748b',
    sort_order: String(initialCategory?.sort_order ?? 0),
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [loading, onClose]);
  const excluded = initialCategory
    ? new Set([initialCategory.id, ...getCategoryDescendantIds(initialCategory.id, categories)])
    : new Set<string>();
  const options = flattenCategoryTree(buildCategoryTree(categories)).filter(
    (category) => !excluded.has(category.id)
  );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setError('Escribe un nombre para la categoría.');
      return;
    }
    setLoading(true);
    setError('');
    const body = {
      name: form.name.trim(),
      parent_id: form.parent_id || null,
      type: form.type,
      budget_type: form.budget_type || null,
      icon: form.icon.trim() || null,
      color: form.color || null,
      sort_order: Number(form.sort_order),
    };
    try {
      const response = await fetch(
        initialCategory ? `/api/categories/${initialCategory.id}` : '/api/categories',
        {
          method: initialCategory ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      const result = readApiError(
        await response.json().catch(() => null),
        'No se pudo guardar la categoría.'
      );
      if (!response.ok) {
        setError(
          result.code === 'category_read_only'
            ? 'Las categorías incluidas son de solo lectura.'
            : result.message
        );
        return;
      }
      onSaved(initialCategory ? 'Categoría actualizada.' : 'Categoría creada.');
      onClose();
    } catch {
      setError('No se pudo conectar con el servidor. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="category-form-title"
    >
      <form
        onSubmit={submit}
        className="surface-enter bg-surface-raised max-h-[calc(100dvh-2rem)] w-full max-w-xl min-w-0 overflow-y-auto rounded-2xl border p-5 shadow-xl"
      >
        <ContextBadge />
        <div className="mt-2 mb-5 flex items-center justify-between">
          <h2 id="category-form-title" className="text-xl font-bold">
            {initialCategory ? 'Editar categoría' : 'Nueva categoría'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            disabled={loading}
            className="grid size-11 shrink-0 place-items-center rounded-xl border"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
        {error && (
          <div
            role="alert"
            className="border-danger bg-danger-soft text-danger mb-4 rounded-xl border p-3 text-sm"
          >
            {error}
          </div>
        )}
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium sm:col-span-2">
            Nombre *
            <input
              autoFocus
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              maxLength={100}
              required
              className="bg-surface mt-1 w-full px-3 py-2"
            />
          </label>
          <label className="text-sm font-medium sm:col-span-2">
            Categoría padre
            <select
              value={form.parent_id}
              onChange={(e) => setForm({ ...form, parent_id: e.target.value })}
              className="bg-surface mt-1 w-full px-3 py-2"
            >
              <option value="">Sin categoría padre</option>
              {options.map((category) => (
                <option key={category.id} value={category.id}>
                  {'— '.repeat(category.depth)}
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            Tipo
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="bg-surface mt-1 w-full px-3 py-2"
            >
              <option value="expense">Gasto</option>
              <option value="income">Ingreso</option>
              <option value="transfer">Transferencia</option>
              <option value="savings">Ahorro</option>
            </select>
          </label>
          <label className="text-sm font-medium">
            Tipo de presupuesto
            <select
              value={form.budget_type}
              onChange={(e) => setForm({ ...form, budget_type: e.target.value })}
              className="bg-surface mt-1 w-full px-3 py-2"
            >
              <option value="">Sin presupuesto</option>
              <option value="need">Necesidad</option>
              <option value="want">Deseo</option>
              <option value="savings">Ahorro</option>
            </select>
          </label>
          <div className="sm:col-span-2">
            <p className="text-sm font-medium">Icono</p>
            <div className="bg-surface mt-1 flex min-h-14 items-center gap-3 rounded-xl border p-2">
              <CategoryIcon value={form.icon} color={form.color} />
              <span className="text-text-muted min-w-0 flex-1 text-sm">
                {
                  CATEGORY_ICON_OPTIONS.find(({ key }) => key === resolveCategoryIconKey(form.icon))
                    ?.label
                }
              </span>
              <button
                type="button"
                aria-expanded={iconPickerOpen}
                aria-controls="category-icon-picker"
                onClick={() => setIconPickerOpen((open) => !open)}
                className="bg-surface hover:bg-surface-subtle min-h-11 shrink-0 rounded-xl border px-3 font-medium"
              >
                Elegir icono
              </button>
            </div>
            {iconPickerOpen && (
              <fieldset
                id="category-icon-picker"
                className="surface-enter bg-surface-subtle mt-3 rounded-2xl border p-3"
              >
                <legend className="px-1 text-sm font-semibold">Selecciona un icono</legend>
                <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-5">
                  {CATEGORY_ICON_OPTIONS.map(({ key, label }) => {
                    const selected = resolveCategoryIconKey(form.icon) === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-label={label}
                        aria-pressed={selected}
                        onClick={() => {
                          setForm({ ...form, icon: key });
                          setIconPickerOpen(false);
                        }}
                        className={`flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-xl border p-1 text-center text-[11px] leading-tight break-words ${selected ? 'border-primary bg-primary-soft text-primary' : 'bg-surface text-text-muted hover:bg-surface-raised hover:text-text'}`}
                      >
                        <CategoryIcon value={key} />
                        <span>{label}</span>
                        {selected && <span className="sr-only">, seleccionado</span>}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            )}
          </div>
          <label className="text-sm font-medium">
            Color
            <input
              type="color"
              value={form.color}
              onChange={(e) => setForm({ ...form, color: e.target.value })}
              className="bg-surface mt-1 h-11 w-full p-1"
            />
          </label>
          <label className="text-sm font-medium">
            Orden
            <input
              type="number"
              value={form.sort_order}
              onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
              min={-10000}
              max={10000}
              step={1}
              className="bg-surface mt-1 w-full px-3 py-2"
            />
          </label>
        </div>
        <div className="mt-6 flex gap-3 border-t pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="min-h-11 flex-1 rounded-xl border px-4 py-2"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading}
            className="bg-primary text-on-primary hover:bg-primary-hover min-h-11 flex-1 rounded-xl px-4 py-2 disabled:opacity-50"
          >
            {loading ? 'Guardando...' : initialCategory ? 'Actualizar' : 'Crear categoría'}
          </button>
        </div>
      </form>
    </div>
  );
}
