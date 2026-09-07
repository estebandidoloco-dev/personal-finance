'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ContextBadge } from '@/components/shell/ContextBadge';
import { readApiError } from '@/lib/api-error';
import { useHousehold } from '@/components/household/HouseholdContext';

const SESSION_KEY = 'household_invitation_token';
const ACCEPTED_FLASH_KEY = 'household_invitation_accepted';

export default function InvitationPage() {
  const router = useRouter(); const { refresh } = useHousehold(); const [token, setToken] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => { const fromHash = new URLSearchParams(window.location.hash.slice(1)).get('token'); const value = fromHash ?? sessionStorage.getItem(SESSION_KEY) ?? ''; if (value) sessionStorage.setItem(SESSION_KEY, value); setToken(value); if (window.location.hash) history.replaceState(null, '', window.location.pathname); }, 0); return () => window.clearTimeout(timer); }, []);
  const resolve = async (action: 'accept' | 'reject') => { if (!/^[0-9a-fA-F]{64}$/.test(token)) { setError('La invitación no es válida o ya no está disponible.'); return; } setBusy(true); setError(''); try { const response = await fetch(`/api/household/invitations/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) }); const payload: unknown = await response.json().catch(() => null); if (!response.ok) { setError(readApiError(payload, 'La invitación no es válida o ya no está disponible.').message); return; } sessionStorage.removeItem(SESSION_KEY); if (action === 'accept') sessionStorage.setItem(ACCEPTED_FLASH_KEY, '1'); setToken(''); router.replace(action === 'accept' ? '/dashboard/household' : '/dashboard/household/setup'); refresh(); router.refresh(); } catch { setError('No se pudo conectar con el servidor.'); } finally { setBusy(false); } };
  return <main className="mx-auto w-full min-w-0 max-w-xl space-y-5"><header><ContextBadge household /><h1 className="mt-2 break-words text-3xl font-bold">Invitación En pareja</h1><p className="mt-2 text-text-muted">Aceptar concede acceso sólo al espacio En pareja. Tus cuentas y movimientos personales permanecen privados.</p></header>{error && <p role="alert" className="rounded-xl border border-danger bg-danger-soft p-3 text-danger">{error}</p>}<section className="w-full min-w-0 rounded-2xl border bg-surface p-5"><label className="text-sm font-medium">Código de invitación<input autoComplete="off" value={token} onChange={(e) => setToken(e.target.value.trim())} className="mt-1 w-full min-w-0 bg-surface px-3" /></label><p className="mt-2 text-xs text-text-muted">El código se conserva temporalmente sólo en esta sesión y se elimina al resolver la invitación.</p><div className="mt-5 flex flex-col gap-2 sm:flex-row"><button disabled={busy} onClick={() => void resolve('accept')} className="min-h-11 flex-1 rounded-xl bg-primary px-4 font-semibold text-on-primary hover:bg-primary-hover">Aceptar invitación</button><button disabled={busy} onClick={() => void resolve('reject')} className="min-h-11 flex-1 rounded-xl border bg-surface px-4 hover:bg-surface-subtle">Rechazar</button></div></section></main>;
}
