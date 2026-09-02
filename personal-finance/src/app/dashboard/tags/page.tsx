'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { readApiError } from '@/lib/api-error';

interface Tag { id: string; name: string; color: string | null }

export default function TagsPage() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [form, setForm] = useState({ name: '', color: '#64748b' });
  const [editing, setEditing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError('');
    try { const response = await fetch('/api/tags'); const result = await response.json().catch(() => null) as unknown; if (!response.ok || !Array.isArray(result)) { setError(readApiError(result, 'No se pudieron cargar las etiquetas.').message); return; } setTags(result); }
    catch { setError('No se pudo conectar con el servidor. Inténtalo de nuevo.'); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    // This effect synchronizes server-backed state on page entry.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);
  const reset = () => { setForm({ name: '', color: '#64748b' }); setEditing(null); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (!form.name.trim()) { setError('Escribe un nombre para la etiqueta.'); return; }
    setSaving(true); setError(''); setSuccess('');
    try { const response = await fetch(editing ? `/api/tags/${editing}` : '/api/tags', { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.name.trim(), color: form.color || null }) }); const result = readApiError(await response.json().catch(() => null), 'No se pudo guardar la etiqueta.'); if (!response.ok) { setError(result.code === 'tag_already_exists' ? 'Ya existe una etiqueta con ese nombre.' : result.message); return; } reset(); setSuccess(editing ? 'Etiqueta actualizada.' : 'Etiqueta creada.'); await load(); }
    catch { setError('No se pudo conectar con el servidor. Inténtalo de nuevo.'); }
    finally { setSaving(false); }
  };
  const remove = async (tag: Tag) => { if (!window.confirm(`¿Eliminar la etiqueta «${tag.name}»?`)) return; setError(''); setDeletingId(tag.id); try { const response = await fetch(`/api/tags/${tag.id}`, { method: 'DELETE' }); const result = readApiError(await response.json().catch(() => null), 'No se pudo eliminar la etiqueta.'); if (!response.ok) { setError(result.message); return; } setSuccess('Etiqueta eliminada.'); await load(); } catch { setError('No se pudo conectar con el servidor.'); } finally { setDeletingId(null); } };

  return <main className="mx-auto max-w-4xl p-4 sm:p-6"><div className="mb-6"><Link href="/dashboard" className="text-sm text-blue-700 hover:underline">← Volver al dashboard</Link><h1 className="mt-2 text-2xl font-bold">Etiquetas</h1><p className="text-sm text-gray-500">Añade etiquetas para encontrar tus movimientos con facilidad.</p></div>{error && <div role="alert" className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}{success && <div role="status" className="mb-4 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">{success}</div>}<form onSubmit={submit} className="mb-6 grid gap-3 rounded-lg border bg-white p-4 sm:grid-cols-[1fr_8rem_auto] dark:bg-gray-800"><label className="text-sm font-medium">{editing ? 'Editar etiqueta' : 'Nueva etiqueta'}<input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={100} required className="mt-1 w-full rounded border px-3 py-2" placeholder="Ej: Vacaciones" /></label><label className="text-sm font-medium">Color<input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="mt-1 h-10 w-full rounded border p-1" /></label><div className="flex items-end gap-2"><button type="submit" disabled={saving} className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50">{saving ? 'Guardando...' : editing ? 'Actualizar' : 'Crear'}</button>{editing && <button type="button" onClick={reset} disabled={saving} className="rounded border px-4 py-2">Cancelar</button>}</div></form>{loading ? <div className="p-10 text-center text-gray-500">Cargando etiquetas...</div> : tags.length === 0 ? <div className="rounded-lg border p-10 text-center text-gray-500">Aún no tienes etiquetas.</div> : <ul className="grid gap-3 sm:grid-cols-2">{tags.map((tag) => <li key={tag.id} className="flex items-center justify-between rounded-lg border bg-white p-4 dark:bg-gray-800"><span className="flex items-center gap-3 font-medium"><span className="h-4 w-4 rounded-full" style={{ backgroundColor: tag.color ?? '#64748b' }} />{tag.name}</span><span className="flex gap-3 text-sm"><button type="button" onClick={() => { setEditing(tag.id); setForm({ name: tag.name, color: tag.color ?? '#64748b' }); }} className="text-blue-700 hover:underline">Editar</button><button type="button" onClick={() => void remove(tag)} disabled={deletingId === tag.id} className="text-red-700 hover:underline disabled:cursor-wait disabled:opacity-50">{deletingId === tag.id ? 'Eliminando...' : 'Eliminar'}</button></span></li>)}</ul>}</main>;
}