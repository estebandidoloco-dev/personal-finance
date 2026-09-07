'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useHousehold } from '@/components/household/HouseholdContext';
import { ContextBadge } from '@/components/shell/ContextBadge';
import { readApiError } from '@/lib/api-error';
import {
  buildHouseholdInvitationLink,
  readCreatedHouseholdInvitation,
  type CreatedHouseholdInvitation,
} from '@/lib/household/invitation-link';

async function requestJson(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(readApiError(payload, 'No se pudo completar la operación.').message);
  return payload;
}

export default function HouseholdSetupPage() {
  const { current, refresh } = useHousehold();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [createdInvitation, setCreatedInvitation] = useState<CreatedHouseholdInvitation | null>(
    null
  );
  const [copyFeedback, setCopyFeedback] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const linkInputRef = useRef<HTMLInputElement>(null);

  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo conectar con el servidor.');
    } finally {
      setBusy(false);
    }
  };

  if (!current)
    return (
      <main className="mx-auto max-w-xl space-y-5">
        <header>
          <ContextBadge household />
          <h1 className="mt-2 text-3xl font-bold">Crear espacio En pareja</h1>
          <p className="text-text-muted mt-2">
            Tus finanzas personales seguirán privadas. El acceso compartido comienza sólo cuando la
            persona invitada acepta.
          </p>
        </header>
        {error && (
          <p
            role="alert"
            className="border-danger bg-danger-soft text-danger rounded-xl border p-3"
          >
            {error}
          </p>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await requestJson('/api/household', 'POST', { name });
              refresh();
            });
          }}
          className="bg-surface rounded-2xl border p-5"
        >
          <label className="text-sm font-medium">
            Nombre del espacio
            <input
              autoFocus
              required
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="bg-surface mt-1 w-full px-3"
              placeholder="Ej. Casa de Ana y Luis"
            />
          </label>
          <button
            disabled={busy}
            className="bg-primary text-on-primary hover:bg-primary-hover mt-4 min-h-11 w-full rounded-xl px-4 font-semibold"
          >
            {busy ? 'Creando…' : 'Crear espacio'}
          </button>
        </form>
        <p className="text-center text-sm">
          ¿Tienes una invitación?{' '}
          <Link href="/dashboard/household/invite" className="text-primary hover:underline">
            Aceptar o rechazar
          </Link>
        </p>
      </main>
    );

  if (current.status === 'active')
    return (
      <main className="space-y-4">
        <p>Tu espacio En pareja ya está activo.</p>
        <Link href="/dashboard/household" className="text-primary hover:underline">
          Ir al resumen
        </Link>
      </main>
    );

  const pending = current.pending_invitation;
  const invitationLink = createdInvitation
    ? buildHouseholdInvitationLink(window.location.origin, createdInvitation.token)
    : null;
  const visibleInvitation = createdInvitation
    ? {
        id: createdInvitation.invitationId,
        invited_email: createdInvitation.invitedEmail,
        expires_at: createdInvitation.expiresAt,
      }
    : pending;

  const copyInvitation = async () => {
    if (!invitationLink) return;
    setCopyFeedback('');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard no disponible');
      await navigator.clipboard.writeText(invitationLink);
      setCopyFeedback('Enlace copiado');
    } catch {
      linkInputRef.current?.focus();
      linkInputRef.current?.select();
      setCopyFeedback(
        'No se pudo copiar automáticamente. El enlace quedó seleccionado para copiarlo manualmente.'
      );
    }
  };

  const revokeInvitation = (invitationId: string) =>
    run(async () => {
      await requestJson(`/api/household/invitations/${invitationId}`, 'DELETE');
      setCreatedInvitation(null);
      setCopyFeedback('');
      setEmail('');
      refresh();
    });

  return (
    <main className="mx-auto max-w-2xl space-y-5">
      <header>
        <ContextBadge household />
        <h1 className="mt-2 text-3xl font-bold break-words">{current.name}</h1>
        <p className="text-text-muted mt-2">
          Esperando pareja. Las funciones financieras se habilitan al aceptar la invitación.
        </p>
      </header>
      {error && (
        <p role="alert" className="border-danger bg-danger-soft text-danger rounded-xl border p-3">
          {error}
        </p>
      )}
      {visibleInvitation ? (
        <section className="surface-enter bg-surface rounded-2xl border p-5">
          <h2 className="font-semibold">
            {createdInvitation ? 'Invitación creada' : 'Invitación pendiente'}
          </h2>
          <p className="mt-2 text-sm">Enviada a {visibleInvitation.invited_email}</p>
          <p className="text-text-muted text-sm">
            Expira:{' '}
            {new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(
              new Date(visibleInvitation.expires_at)
            )}
          </p>
          {invitationLink ? (
            <div className="bg-primary-soft mt-4 rounded-xl p-4">
              <p className="text-text font-semibold">
                Comparte este enlace con tu pareja. Por seguridad, solo se muestra una vez.
              </p>
              <label className="mt-3 block text-sm font-medium" htmlFor="household-invitation-link">
                Enlace de invitación
              </label>
              <input
                ref={linkInputRef}
                id="household-invitation-link"
                readOnly
                value={invitationLink}
                onFocus={(event) => event.currentTarget.select()}
                className="bg-surface mt-1 w-full px-3 text-sm"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void copyInvitation()}
                className="bg-primary text-on-primary hover:bg-primary-hover mt-3 min-h-11 rounded-xl px-4 font-semibold disabled:opacity-50"
              >
                Copiar invitación
              </button>
              <p aria-live="polite" role="status" className="text-primary mt-2 min-h-5 text-sm">
                {copyFeedback}
              </p>
            </div>
          ) : (
            <p className="bg-warning-soft text-warning mt-4 rounded-xl p-3 text-sm">
              El enlace ya no está disponible. Revoca esta invitación y crea una nueva si necesitas
              otro enlace.
            </p>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void revokeInvitation(visibleInvitation.id)}
            className="text-danger mt-4 min-h-11 hover:underline disabled:opacity-50"
          >
            Revocar invitación
          </button>
        </section>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const submittedEmail = email.trim();
            void run(async () => {
              const payload = await requestJson('/api/household/invitations', 'POST', {
                household_id: current.id,
                invited_email: submittedEmail,
              });
              const invitation = readCreatedHouseholdInvitation(payload, submittedEmail);
              if (!invitation) {
                refresh();
                throw new Error(
                  'La invitación se creó, pero la respuesta no incluyó un enlace válido. Revócala antes de intentar de nuevo.'
                );
              }
              setCreatedInvitation(invitation);
              setCopyFeedback('');
            });
          }}
          className="bg-surface rounded-2xl border p-5"
        >
          <label className="text-sm font-medium">
            Correo de tu pareja
            <input
              required
              type="email"
              maxLength={320}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="bg-surface mt-1 w-full px-3"
            />
          </label>
          <button
            disabled={busy}
            className="bg-primary text-on-primary hover:bg-primary-hover mt-4 min-h-11 rounded-xl px-4 font-semibold disabled:opacity-50"
          >
            {busy ? 'Creando…' : 'Crear invitación'}
          </button>
        </form>
      )}
    </main>
  );
}
