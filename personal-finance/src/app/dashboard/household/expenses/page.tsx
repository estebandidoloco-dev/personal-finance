'use client';

import Link from 'next/link';
import { useHousehold } from '@/components/household/HouseholdContext';
import { HouseholdHeader } from '@/components/household/HouseholdHeader';
import { HouseholdActivityList } from '@/components/household/HouseholdActivityList';
import { EmptyState } from '@/components/shell/EmptyState';

export default function HouseholdExpensesPage() {
  const { current, userId } = useHousehold();
  if (!current) return <EmptyState title="Primero crea o acepta un espacio" action={<Link href="/dashboard/household/setup" className="text-primary">Configurar</Link>} />;
  if (current.status !== 'active') return <EmptyState title="Esperando a tu pareja" description="Los gastos se habilitan cuando la invitación se acepta." />;
  return <main className="space-y-6"><HouseholdHeader name={current.name} status={current.status} writable /><HouseholdActivityList householdId={current.id} endpoint="expenses" userId={userId} /></main>;
}
