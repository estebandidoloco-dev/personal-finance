'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { buildCategoryTree, flattenCategoryTree, getCategoryDescendantIds, type CategoryItem } from '@/lib/categories';
import { readApiError } from '@/lib/api-error';

interface CategoryFormProps { categories: CategoryItem[]; initialCategory?: CategoryItem; onClose: () => void; onSaved: (message: string) => void; }

export function CategoryForm({ categories, initialCategory, onClose, onSaved }: CategoryFormProps) {
  const [form, setForm] = useState({ name: initialCategory?.name ?? '', parent_id: initialCategory?.parent_id ?? '', type: initialCategory?.type ?? 'expense', budget_type: initialCategory?.budget_type ?? '', icon: initialCategory?.icon ?? '', color: initialCategory?.color ?? '#64748b', sort_order: String(initialCategory?.sort_order ?? 0) });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [loading, onClose]);
  const excluded = initialCategory ? new Set([initialCategory.id, ...getCategoryDescendantIds(initialCategory.id, categories)]) : new Set<string>();
  const options = flattenCategoryTree(buildCategoryTree(categories)).filter((category) => !excluded.has(category.id));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) { setError('Escribe un nombre para la categoría.'); return; }
    setLoading(true); setError('');
    const body = { name: form.name.trim(), parent_id: form.parent_id || null, type: form.type, budget_type: form.budget_type || null, icon: form.icon.trim() || null, color: form.color || null, sort_order: Number(form.sort_order) };
    try {
      const response = await fetch(initialCategory ? `/api/categories/${initialCategory.id}` : '/api/categories', { method: initialCategory ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = readApiError(await response.json().catch(() => null), 'No se pudo guardar la categoría.');
      if (!response.ok) { setError(result.code === 'category_read_only' ? 'Las categorías globales son de solo lectura.' : result.message); return; }
      onSaved(initialCategory ? 'Categoría actualizada.' : 'Categoría creada.'); onClose();
    } catch { setError('No se pudo conectar con el servidor. Inténtalo de nuevo.'); }
    finally { setLoading(false); }
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="category-form-title"><form onSubmit={submit} className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800"><div className="mb-5 flex items-center justify-between"><h2 id="category-form-title" className="text-xl font-bold">{initialCategory ? 'Editar categoría' : 'Nueva categoría'}</h2><button type="button" onClick={onClose} aria-label="Cerrar" disabled={loading}><X /></button></div>{error && <div role="alert" className="mb-4 rounded bg-red-100 p-3 text-sm text-red-800">{error}</div>}<div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium sm:col-span-2">Nombre *<input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={100} required className="mt-1 w-full rounded border px-3 py-2" /></label><label className="text-sm font-medium sm:col-span-2">Categoría padre<select value={form.parent_id} onChange={(e) => setForm({ ...form, parent_id: e.target.value })} className="mt-1 w-full rounded border px-3 py-2"><option value="">Sin categoría padre</option>{options.map((category) => <option key={category.id} value={category.id}>{'— '.repeat(category.depth)}{category.name}</option>)}</select></label><label className="text-sm font-medium">Tipo<select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="mt-1 w-full rounded border px-3 py-2"><option value="expense">Gasto</option><option value="income">Ingreso</option><option value="transfer">Transferencia</option><option value="savings">Ahorro</option></select></label><label className="text-sm font-medium">Tipo de presupuesto<select value={form.budget_type} onChange={(e) => setForm({ ...form, budget_type: e.target.value })} className="mt-1 w-full rounded border px-3 py-2"><option value="">Sin presupuesto</option><option value="need">Necesidad</option><option value="want">Deseo</option><option value="savings">Ahorro</option></select></label><label className="text-sm font-medium">Icono<input value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} maxLength={50} placeholder="🍎" className="mt-1 w-full rounded border px-3 py-2" /></label><label className="text-sm font-medium">Color<input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="mt-1 h-10 w-full rounded border p-1" /></label><label className="text-sm font-medium">Orden<input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} min={-10000} max={10000} step={1} className="mt-1 w-full rounded border px-3 py-2" /></label></div><div className="mt-6 flex gap-3 border-t pt-4"><button type="button" onClick={onClose} disabled={loading} className="flex-1 rounded border px-4 py-2">Cancelar</button><button type="submit" disabled={loading} className="flex-1 rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50">{loading ? 'Guardando...' : initialCategory ? 'Actualizar' : 'Crear categoría'}</button></div></form></div>;
}