'use client';

import { useParams } from 'next/navigation';
import { householdAccountSchema } from '@/lib/contracts/household';
import { useHousehold } from '@/components/household/HouseholdContext';
import { useApiResource } from '@/hooks/use-api-resource';
import { HouseholdAccountForm } from '@/components/household/HouseholdAccountForm';
import { ContextBadge } from '@/components/shell/ContextBadge';
import { AsyncState } from '@/components/shell/AsyncState';
import { ErrorPanel } from '@/components/shell/ErrorPanel';
import { EmptyState } from '@/components/shell/EmptyState';

export default function EditHouseholdAccountPage() {
  const id = useParams<{ id: string }>().id;
  const { current } = useHousehold();
  const householdId = current?.id ?? '';
  const resource = useApiResource(async (signal) => {
    const response = await fetch(`/api/household/accounts?household_id=${householdId}`, {
      signal,
    });
    const payload: unknown = await response.json();
    if (!response.ok) throw new Error('No se pudo cargar la cuenta.');
    const account = householdAccountSchema
      .array()
      .parse(payload)
      .find((item) => item.id === id);
    if (!account) throw new Error('La cuenta no está disponible.');
    return account;
  }, `${householdId}:${id}`);
  if (!current || current.status !== 'active')
    return <EmptyState title="No hay un espacio activo" />;
  return (
    <main className="mx-auto w-full max-w-xl min-w-0 space-y-5">
      <header>
        <ContextBadge household />
        <h1 className="mt-2 text-3xl font-bold">Editar cuenta común</h1>
      </header>
      {resource.status === 'loading' && <AsyncState />}
      {resource.status === 'error' && (
        <ErrorPanel message={resource.error} onRetry={resource.retry} />
      )}
      {(resource.status === 'success' || resource.status === 'empty') && (
        <HouseholdAccountForm householdId={current.id} account={resource.data} />
      )}
    </main>
  );
}
