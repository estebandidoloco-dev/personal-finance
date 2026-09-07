'use client';

import Link from 'next/link';
import { useHousehold } from '@/components/household/HouseholdContext';
import { HouseholdHeader } from '@/components/household/HouseholdHeader';
import { HouseholdActivityList } from '@/components/household/HouseholdActivityList';
import { EmptyState } from '@/components/shell/EmptyState';

export default function HouseholdHistoryPage() {
  const { current, userId } = useHousehold();
  if (!current || current.status !== 'active')
    return (
      <EmptyState
        title="No hay un espacio activo"
        action={
          <Link href="/dashboard/household/archive" className="text-primary">
            Ver espacios anteriores
          </Link>
        }
      />
    );
  return (
    <main className="space-y-6">
      <HouseholdHeader name={current.name} status={current.status} />
      <header>
        <h2 className="text-2xl font-bold">Historial completo</h2>
        <p className="text-text-muted mt-1">
          Gastos compartidos e ingresos o movimientos de cuentas comunes.
        </p>
      </header>
      <HouseholdActivityList householdId={current.id} endpoint="history" userId={userId} />
    </main>
  );
}
