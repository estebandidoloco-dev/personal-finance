'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CategoryForm } from '@/components/ui/CategoryForm';
import { CategoryTree } from '@/components/ui/CategoryTree';
import { buildCategoryTree, type CategoryItem } from '@/lib/categories';
import { readApiError } from '@/lib/api-error';

export default function CategoriesPage() {
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editing, setEditing] = useState<CategoryItem | undefined>();
  const [formOpen, setFormOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const newCategoryButtonRef = useRef<HTMLButtonElement>(null);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/categories');
      const result = await response.json().catch(() => null) as unknown;
      if (!response.ok || !Array.isArray(result)) { setError(readApiError(result, 'No se pudieron cargar las categorías.').message); return; }
      setCategories(result);
    } catch { setError('No se pudo conectar con el servidor. Inténtalo de nuevo.'); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    // This effect synchronizes server-backed state on page entry.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  const deleteCategory = async (category: CategoryItem) => {
    if (!window.confirm(`¿Eliminar la categoría «${category.name}»? Esta acción no se puede deshacer.`)) return;
    setError(''); setSuccess(''); setDeletingId(category.id);
    try {
      const response = await fetch(`/api/categories/${category.id}`, { method: 'DELETE' });
      const result = readApiError(await response.json().catch(() => null), 'No se pudo eliminar la categoría.');
      if (!response.ok) { setError(result.code === 'category_in_use' ? 'No puedes eliminar esta categoría porque está siendo usada por un presupuesto.' : result.message); return; }
      setSuccess('Categoría eliminada.'); await load();
    } catch { setError('No se pudo conectar con el servidor. Inténtalo de nuevo.'); }
    finally { setDeletingId(null); }
  };

  const tree = buildCategoryTree(categories);
  const closeForm = () => { setFormOpen(false); window.setTimeout(() => newCategoryButtonRef.current?.focus(), 0); };
  return <main className="mx-auto max-w-5xl p-4 sm:p-6">
    <div className="mb-6 flex flex-col items-start gap-4 sm:flex-row sm:items-end sm:justify-between"><div><Link href="/dashboard" className="text-sm text-blue-700 hover:underline">← Volver al dashboard</Link><h1 className="mt-2 text-2xl font-bold">Categorías</h1><p className="text-sm text-gray-500">Organiza tus gastos e ingresos. Las categorías globales son de solo lectura.</p></div><button ref={newCategoryButtonRef} type="button" onClick={() => { setEditing(undefined); setFormOpen(true); }} className="rounded bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800">Nueva categoría</button></div>
    {error && <div role="alert" className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    {success && <div role="status" className="mb-4 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">{success}</div>}
    {loading ? <div className="rounded-lg border bg-white p-10 text-center text-gray-500 dark:bg-gray-800">Cargando categorías...</div> : categories.length === 0 ? <div className="rounded-lg border bg-white p-10 text-center dark:bg-gray-800"><p className="text-gray-600">No hay categorías disponibles.</p><button type="button" onClick={() => setFormOpen(true)} className="mt-3 text-blue-700 hover:underline">Crear la primera categoría</button></div> : <CategoryTree nodes={tree} deletingId={deletingId} onEdit={(category) => { setEditing(category); setFormOpen(true); }} onDelete={(category) => void deleteCategory(category)} />}
    {formOpen && <CategoryForm categories={categories} initialCategory={editing} onClose={closeForm} onSaved={(message) => { setSuccess(message); void load(); }} />}
  </main>;
}