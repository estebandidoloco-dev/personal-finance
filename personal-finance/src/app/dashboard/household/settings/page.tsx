'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useHousehold } from '@/components/household/HouseholdContext';
import { HouseholdHeader } from '@/components/household/HouseholdHeader';
import { ConfirmDialog } from '@/components/shell/ConfirmDialog';
import { AsyncState } from '@/components/shell/AsyncState';
import { EmptyState } from '@/components/shell/EmptyState';
import { ErrorPanel } from '@/components/shell/ErrorPanel';
import { useApiResource } from '@/hooks/use-api-resource';
import { memberSchema } from '@/lib/contracts/household';
import { closeHousehold } from '@/lib/household/close-household';
import { memberName } from '@/lib/household/presentation';

export default function HouseholdSettingsPage() {
  const router = useRouter();
  const { current, userId, refresh } = useHousehold();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const membersResource = useApiResource(async (signal) => {
    if (!current) return [];
    const response = await fetch(
      `/api/household/members?household_id=${encodeURIComponent(current.id)}`,
      { signal }
    );
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error('No se pudieron cargar los miembros del espacio.');
    const schema =
      current.status === 'active'
        ? memberSchema.array().length(2)
        : memberSchema.array().min(1).max(2);
    return schema.parse(payload);
  }, current?.id ?? 'no-household');

  if (!current) {
    return (
      <EmptyState
        title="No hay un espacio En pareja vigente"
        action={
          <Link href="/dashboard/household/archive" className="text-primary">
            Ver espacios anteriores
          </Link>
        }
      />
    );
  }
  if (membersResource.status === 'loading') {
    return <AsyncState label="Cargando configuración del espacio…" />;
  }
  if (membersResource.status === 'error') {
    return <ErrorPanel message={membersResource.error} onRetry={membersResource.retry} />;
  }

  const close = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await closeHousehold(current.id);
      setConfirming(false);
      refresh();
      router.replace(`/dashboard/household/archive/${current.id}`);
      router.refresh();
    } catch {
      setError('No pudimos cerrar el espacio. No se realizaron cambios.');
    } finally {
      setBusy(false);
    }
  };

  const members = membersResource.data;
  return (
    <main className="min-w-0 space-y-7">
      <HouseholdHeader name={current.name} status={current.status} />
      <header>
        <h1 className="text-3xl font-bold">Configuración</h1>
        <p className="text-text-muted mt-2">Información general de tu espacio En pareja.</p>
      </header>
      {error && (
        <p role="alert" className="border-danger bg-danger-soft text-danger rounded-xl border p-3">
          {error}
        </p>
      )}
      <section className="bg-surface max-w-2xl rounded-2xl border p-5">
        <h2 className="text-lg font-bold">Datos del espacio</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-[9rem_minmax(0,1fr)]">
          <dt className="text-text-muted text-sm">Nombre del espacio</dt>
          <dd className="font-semibold break-words">{current.name}</dd>
          <dt className="text-text-muted text-sm">Miembros</dt>
          <dd className="break-words">
            {members.map((member) => memberName(member, userId)).join(' · ')}
          </dd>
          <dt className="text-text-muted text-sm">Moneda</dt>
          <dd className="font-semibold">{current.currency}</dd>
        </dl>
      </section>
      <section className="border-danger bg-surface max-w-2xl rounded-2xl border p-5">
        <p className="text-text-muted text-sm font-semibold">Administración del espacio</p>
        <h2 className="mt-3 text-lg font-bold">Cerrar espacio</h2>
        <p className="text-text-muted mt-2 max-w-xl text-sm">
          El espacio pasará a «Espacios anteriores». Podrás consultar gastos, cuentas e historial,
          pero ya no modificarlo.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirming(true)}
          className="border-danger bg-danger-soft text-danger mt-4 min-h-11 rounded-xl border px-4 font-semibold disabled:opacity-50"
        >
          {busy ? 'Cerrando…' : 'Cerrar espacio'}
        </button>
      </section>
      <ConfirmDialog
        open={confirming}
        title={`¿Cerrar ${current.name}?`}
        description="Después de cerrarlo, este espacio quedará en modo de solo lectura. Tus datos históricos se conservarán."
        confirmLabel="Cerrar espacio"
        busy={busy}
        onConfirm={() => void close()}
        onClose={() => setConfirming(false)}
      />
    </main>
  );
}
