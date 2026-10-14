'use client';

import { useState } from 'react';
import Link from 'next/link';
import { dashboardResponseSchema, type DashboardResponse } from '@/lib/validation/dashboard';
import { useApiResource } from '@/hooks/use-api-resource';
import { Button } from '@/components/ui/button';
import { DashboardPeriodSelector } from '@/components/dashboard/DashboardPeriodSelector';
import { SummaryCards } from '@/components/dashboard/SummaryCards';
import { AccountsSummary } from '@/components/dashboard/AccountsSummary';
import { IncomeExpenseChart } from '@/components/dashboard/IncomeExpenseChart';
import { CategoryExpensesChart } from '@/components/dashboard/CategoryExpensesChart';
import { RecentTransactions } from '@/components/dashboard/RecentTransactions';
import { ContextBadge } from '@/components/shell/ContextBadge';
import { AsyncState } from '@/components/shell/AsyncState';
import { ErrorPanel } from '@/components/shell/ErrorPanel';

type Period = DashboardResponse['period']['key'];

export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>('this_month');
  const resource = useApiResource(async (signal) => {
    const response = await fetch(`/api/dashboard?period=${period}`, { signal });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error('No se pudo cargar tu resumen personal.');
    const parsed = dashboardResponseSchema.safeParse(payload);
    if (!parsed.success) throw new Error('El resumen recibido no cumple el contrato financiero.');
    return parsed.data;
  }, period);

  return (
    <main className="space-y-7">
      <header className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <ContextBadge />
          <h1 className="heading mt-2 text-3xl font-bold tracking-tight">Resumen personal</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tu saldo, cuentas y movimientos confirmados.
          </p>
        </div>
        <DashboardPeriodSelector
          value={period}
          onChange={(value) => setPeriod(value as Period)}
          disabled={resource.status === 'loading'}
        />
      </header>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
        <Button asChild size="default">
          <Link href="/dashboard/transactions">Registrar movimiento</Link>
        </Button>
        <Button asChild variant="outline" size="default">
          <Link href="/dashboard/accounts/new">Crear cuenta</Link>
        </Button>
      </div>
      {resource.status === 'loading' && <AsyncState label="Cargando resumen personal…" />}
      {resource.status === 'error' && <ErrorPanel message={resource.error} onRetry={resource.retry} />}
      {(resource.status === 'success' || resource.status === 'empty') && (
        <>
          <SummaryCards
            totalBalance={resource.data.totals.total_balance}
            income={resource.data.totals.income}
            expense={resource.data.totals.expense}
            net={resource.data.totals.net}
          />
          <AccountsSummary accounts={resource.data.accounts} />
          <div className="grid gap-6 xl:grid-cols-2">
            <IncomeExpenseChart data={resource.data.time_series.points} />
            <CategoryExpensesChart data={resource.data.expenses_by_category} />
          </div>
          <RecentTransactions transactions={resource.data.recent_transactions} />
        </>
      )}
    </main>
  );
}
