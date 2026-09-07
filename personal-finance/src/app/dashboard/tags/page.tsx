'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, MoreHorizontal, X } from 'lucide-react';
import { readApiError } from '@/lib/api-error';
import { ConfirmDialog } from '@/components/shell/ConfirmDialog';
import { ContextBadge } from '@/components/shell/ContextBadge';

interface Tag {
  id: string;
  name: string;
  color: string | null;
}
const DEFAULT_COLOR = '#5f7668';
const PALETTE = ['#5f7668', '#597080', '#9a6a32', '#b74a51', '#756b59', '#6d6474'];

export default function TagsPage() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [form, setForm] = useState({ name: '', color: DEFAULT_COLOR });
  const [editing, setEditing] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Tag | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/tags');
      const result = (await response.json().catch(() => null)) as unknown;
      if (!response.ok || !Array.isArray(result)) {
        setError(readApiError(result, 'No se pudieron cargar las etiquetas.').message);
        return;
      }
      setTags(result);
    } catch {
      setError('No se pudo conectar con el servidor. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    // Initial synchronization with the server-backed tag list.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);
  const closeForm = () => {
    setForm({ name: '', color: DEFAULT_COLOR });
    setEditing(null);
    setFormOpen(false);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setError('Escribe un nombre para la etiqueta.');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const response = await fetch(editing ? `/api/tags/${editing}` : '/api/tags', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name.trim(), color: form.color || null }),
      });
      const result = readApiError(
        await response.json().catch(() => null),
        'No se pudo guardar la etiqueta.'
      );
      if (!response.ok) {
        setError(
          result.code === 'tag_already_exists'
            ? 'Ya existe una etiqueta con ese nombre.'
            : result.message
        );
        return;
      }
      const message = editing ? 'Etiqueta actualizada' : 'Etiqueta creada';
      closeForm();
      setSuccess(message);
      await load();
    } catch {
      setError('No se pudo conectar con el servidor. Inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!deleting) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/tags/${deleting.id}`, { method: 'DELETE' });
      const result = readApiError(
        await response.json().catch(() => null),
        'No se pudo eliminar la etiqueta.'
      );
      if (!response.ok) {
        setError(result.message);
        return;
      }
      setDeleting(null);
      setSuccess('Etiqueta eliminada');
      await load();
    } catch {
      setError('No se pudo conectar con el servidor.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-4xl min-w-0 space-y-6">
      <header className="flex flex-col items-start gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <ContextBadge />
          <h1 className="mt-2 text-2xl font-bold">Etiquetas</h1>
          <p className="text-text-muted mt-1 max-w-xl text-sm">
            Agrupa movimientos de un mismo viaje, proyecto o evento.
          </p>
          <Link
            href="/dashboard"
            className="text-primary inline-flex min-h-11 items-center gap-2 text-sm hover:underline"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Volver al resumen
          </Link>
        </div>
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          className="bg-primary text-on-primary hover:bg-primary-hover min-h-11 w-full rounded-xl px-4 font-semibold sm:w-auto"
        >
          Crear etiqueta
        </button>
      </header>
      {error && (
        <div
          role="alert"
          className="border-danger bg-danger-soft text-danger rounded-xl border p-4 text-sm"
        >
          {error}
        </div>
      )}
      {success && (
        <div
          role="status"
          aria-live="polite"
          className="surface-enter bg-success text-on-primary fixed top-20 right-4 z-40 rounded-xl px-4 py-3 text-sm font-semibold shadow-lg"
        >
          {success}
        </div>
      )}
      {loading ? (
        <div className="bg-surface-subtle h-20 animate-pulse rounded-2xl">
          <span className="sr-only">Cargando etiquetas…</span>
        </div>
      ) : tags.length === 0 ? (
        <div className="text-text-muted rounded-2xl border border-dashed p-8 text-center">
          Aún no tienes etiquetas.
        </div>
      ) : (
        <ul className="bg-surface divide-y rounded-2xl border">
          {tags.map((tag) => (
            <li
              key={tag.id}
              className="relative flex min-w-0 items-center justify-between gap-3 p-4"
            >
              <span className="flex min-w-0 items-center gap-3 font-medium">
                <span
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: tag.color ?? DEFAULT_COLOR }}
                />
                <span className="break-words">{tag.name}</span>
              </span>
              <button
                type="button"
                aria-label={`Acciones para ${tag.name}`}
                aria-expanded={menuId === tag.id}
                onClick={() => setMenuId((value) => (value === tag.id ? null : tag.id))}
                className="hover:bg-surface-subtle grid size-11 shrink-0 place-items-center rounded-xl"
              >
                <MoreHorizontal aria-hidden="true" className="size-5" />
              </button>
              {menuId === tag.id && (
                <div className="surface-enter bg-surface-raised absolute top-14 right-4 z-20 min-w-36 rounded-xl border p-1 shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuId(null);
                      setEditing(tag.id);
                      setForm({ name: tag.name, color: tag.color ?? DEFAULT_COLOR });
                      setFormOpen(true);
                    }}
                    className="hover:bg-surface-subtle min-h-11 w-full rounded-lg px-3 text-left text-sm"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuId(null);
                      setDeleting(tag);
                    }}
                    className="text-danger hover:bg-danger-soft min-h-11 w-full rounded-lg px-3 text-left text-sm"
                  >
                    Eliminar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {formOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="tag-form-title"
          className="bg-text/55 fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center sm:p-4"
        >
          <form
            onSubmit={submit}
            className="surface-enter bg-surface-raised max-h-[calc(100dvh-1rem)] w-full overflow-y-auto rounded-t-3xl border p-5 shadow-xl sm:max-w-lg sm:rounded-2xl"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id="tag-form-title" className="text-xl font-bold">
                {editing ? 'Editar etiqueta' : 'Crear etiqueta'}
              </h2>
              <button
                type="button"
                aria-label="Cerrar"
                onClick={closeForm}
                className="grid size-11 place-items-center rounded-xl border"
              >
                <X aria-hidden="true" className="size-5" />
              </button>
            </div>
            <label className="mt-5 block text-sm font-medium">
              Nombre
              <input
                autoFocus
                required
                maxLength={100}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Ej. Vacaciones"
                className="bg-surface mt-1 w-full px-3"
              />
            </label>
            <fieldset className="mt-4">
              <legend className="text-sm font-medium">Color</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {PALETTE.map((color) => (
                  <label
                    key={color}
                    className={`grid size-11 cursor-pointer place-items-center rounded-full border-2 ${form.color === color ? 'border-primary' : 'border-transparent'}`}
                    style={{ backgroundColor: color }}
                  >
                    <input
                      type="radio"
                      name="tag-color"
                      value={color}
                      checked={form.color === color}
                      onChange={() => setForm({ ...form, color })}
                      className="sr-only"
                    />
                    <span className="sr-only">Color {color}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeForm}
                className="bg-surface min-h-11 rounded-xl border px-4"
              >
                Cancelar
              </button>
              <button
                disabled={saving}
                className="bg-primary text-on-primary hover:bg-primary-hover min-h-11 rounded-xl px-5 font-semibold disabled:opacity-50"
              >
                {saving ? 'Guardando…' : 'Guardar etiqueta'}
              </button>
            </div>
          </form>
        </div>
      )}
      <ConfirmDialog
        open={deleting !== null}
        title="¿Eliminar esta etiqueta?"
        description="La etiqueta dejará de estar disponible para organizar movimientos."
        confirmLabel="Eliminar etiqueta"
        busy={saving}
        onConfirm={() => void remove()}
        onClose={() => setDeleting(null)}
      />
    </main>
  );
}
