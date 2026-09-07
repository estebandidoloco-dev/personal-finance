'use client';

import Link from 'next/link';
import { useHousehold } from '@/components/household/HouseholdContext';
import { HouseholdHeader } from '@/components/household/HouseholdHeader';
import { HouseholdAccountsView } from '@/components/household/HouseholdAccountsView';
import { EmptyState } from '@/components/shell/EmptyState';

export default function HouseholdAccountsPage() { const { current } = useHousehold(); if (!current) return <EmptyState title="Primero crea o acepta un espacio" action={<Link href="/dashboard/household/setup" className="text-primary">Configurar</Link>} />; if (current.status !== 'active') return <EmptyState title="Esperando a tu pareja" description="Las cuentas comunes se habilitan cuando la invitación se acepta." />; return <main className="min-w-0 space-y-6"><HouseholdHeader name={current.name} status={current.status} writable /><HouseholdAccountsView householdId={current.id} /></main>; }
