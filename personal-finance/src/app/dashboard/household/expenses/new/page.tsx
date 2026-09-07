'use client';

import Link from 'next/link';
import { useHousehold } from '@/components/household/HouseholdContext';
import { HouseholdExpenseForm } from '@/components/household/HouseholdExpenseForm';
import { EmptyState } from '@/components/shell/EmptyState';
import { ContextBadge } from '@/components/shell/ContextBadge';

export default function NewHouseholdExpensePage() {
  const { current, userId } = useHousehold();
  if (!current || current.status !== 'active') return <EmptyState title="No hay un espacio activo" action={<Link href="/dashboard/household" className="text-primary">Volver al resumen</Link>} />;
  return <main className="mx-auto w-full min-w-0 max-w-2xl space-y-5"><header><ContextBadge household /><h1 className="mt-2 text-3xl font-bold">Registrar gasto</h1><p className="mt-2 text-text-muted">Quién registra se identifica con tu sesión. Los fondos comunes pertenecen a ambos.</p></header><HouseholdExpenseForm householdId={current.id} userId={userId} /></main>;
}
