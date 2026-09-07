'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CategoryForm } from '@/components/ui/CategoryForm';
import { ContextBadge } from '@/components/shell/ContextBadge';
import { CategoryTree } from '@/components/ui/CategoryTree';
import { buildCategoryTree, type CategoryItem } from '@/lib/categories';
import { readApiError } from '@/lib/api-error';
import { ConfirmDialog } from '@/components/shell/ConfirmDialog';

export default function CategoriesPage() {
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editing, setEditing] = useState<CategoryItem | undefined>();
  const [formOpen, setFormOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<CategoryItem | null>(null);
  const newCategoryButtonRef = useRef<HTMLButtonElement>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/categories');
      const result = (await response.json().catch(() => null)) as unknown;
      if (!response.ok || !Array.isArray(result)) {
        setError(readApiError(result, 'No se pudieron cargar las categorías.').message);
        return;
      }
      setCategories(result);
    } catch {
      setError('No se pudo conectar con el servidor. Inténtalo de nuevo.');
      setDeleteCandidate(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    // This effect synchronizes server-backed state on page entry.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  const deleteCategory = async (category: CategoryItem) => {
    setError('');
    setSuccess('');
    setDeletingId(category.id);
    try {
      const response = await fetch(`/api/categories/${category.id}`, { method: 'DELETE' });
      const result = readApiError(
        await response.json().catch(() => null),
        'No se pudo eliminar la categoría.'
      );
      if (!response.ok) {
        setError(
          result.code === 'category_in_use'
            ? 'No puedes eliminar esta categoría porque está siendo usada por un presupuesto.'
            : result.message
        );
        setDeleteCandidate(null);
        return;
      }
      setDeleteCandidate(null);
      setSuccess('Categoría eliminada.');
      await load();
    } catch {
      setError('No se pudo conectar con el servidor. Inténtalo de nuevo.');
      setDeleteCandidate(null);
    } finally {
      setDeletingId(null);
    }
  };

  const includedTree = buildCategoryTree(
    categories.filter((category) => category.is_system || category.user_id === null)
  );
  const personalTree = buildCategoryTree(
    categories.filter((category) => !category.is_system && category.user_id !== null)
  );
  const closeForm = () => {
    setFormOpen(false);
    window.setTimeout(() => newCategoryButtonRef.current?.focus(), 0);
  };
  return (
    <main className="mx-auto w-full max-w-5xl min-w-0">
      <div className="mb-6 flex flex-col items-start gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <ContextBadge />
          <h1 className="mt-2 text-2xl font-bold">Categorías</h1>
          <p className="text-text-muted text-sm">
            Organiza tus gastos e ingresos con categorías incluidas y propias.
          </p>
          <Link
            href="/dashboard"
            className="text-primary mt-2 inline-flex min-h-11 items-center text-sm hover:underline"
          >
            ← Volver al resumen
          </Link>
        </div>
        <button
          ref={newCategoryButtonRef}
          type="button"
          onClick={() => {
            setEditing(undefined);
            setFormOpen(true);
          }}
          className="bg-primary text-on-primary hover:bg-primary-hover min-h-11 w-full rounded-xl px-4 font-medium sm:w-auto"
        >
          Crear categoría
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
      {success && (
        <div
          role="status"
          className="surface-enter border-success bg-success-soft text-success mb-4 rounded-xl border p-3 text-sm"
        >
          {success}
        </div>
      )}
      {loading ? (
        <div className="bg-surface text-text-muted rounded-2xl border p-10 text-center">
          Cargando categorías…
        </div>
      ) : categories.length === 0 ? (
        <div className="bg-surface rounded-2xl border p-10 text-center">
          <p className="text-text-muted">No hay categorías disponibles.</p>
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="text-primary mt-3 min-h-11 hover:underline"
          >
            Crear la primera categoría
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold">Categorías incluidas</h2>
              <span className="text-text-muted text-sm">Solo lectura</span>
            </div>
            <CategoryTree
              readOnly
              nodes={includedTree}
              deletingId={deletingId}
              onEdit={() => undefined}
              onDelete={() => undefined}
            />
          </section>
          <section>
            <h2 className="mb-3 text-lg font-bold">Tus categorías</h2>
            {personalTree.length ? (
              <CategoryTree
                nodes={personalTree}
                deletingId={deletingId}
                onEdit={(category) => {
                  setEditing(category);
                  setFormOpen(true);
                }}
                onDelete={(category) => setDeleteCandidate(category)}
              />
            ) : (
              <div className="text-text-muted rounded-2xl border border-dashed p-6 text-center text-sm">
                Aún no has creado categorías propias.
              </div>
            )}
          </section>
        </div>
      )}
      {formOpen && (
        <CategoryForm
          categories={categories}
          initialCategory={editing}
          onClose={closeForm}
          onSaved={(message) => {
            setSuccess(message);
            void load();
          }}
        />
      )}
      <ConfirmDialog
        open={deleteCandidate !== null}
        title={`¿Eliminar “${deleteCandidate?.name ?? ''}”?`}
        description="Esta categoría dejará de estar disponible para nuevos movimientos. Si existe una restricción del backend, mostraremos el motivo antes de realizar cambios."
        confirmLabel="Eliminar categoría"
        busy={deletingId !== null}
        onConfirm={() => {
          if (deleteCandidate) void deleteCategory(deleteCandidate);
        }}
        onClose={() => {
          if (!deletingId) setDeleteCandidate(null);
        }}
      />
    </main>
  );
}
