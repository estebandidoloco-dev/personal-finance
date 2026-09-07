'use client';

import { useHousehold } from '@/components/household/HouseholdContext';
import { HouseholdAccountForm } from '@/components/household/HouseholdAccountForm';
import { EmptyState } from '@/components/shell/EmptyState';
import { ContextBadge } from '@/components/shell/ContextBadge';

export default function NewHouseholdAccountPage() {
  const { current } = useHousehold();
  if (!current || current.status !== 'active')
    return <EmptyState title="No hay un espacio activo" />;
  return (
    <main className="mx-auto w-full max-w-xl min-w-0 space-y-5">
      <header>
        <ContextBadge household />
        <h1 className="mt-2 text-3xl font-bold">Nueva cuenta común</h1>
      </header>
      <HouseholdAccountForm householdId={current.id} />
    </main>
  );
}
