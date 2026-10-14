import Link from 'next/link';
import type { DashboardResponse } from '@/lib/validation/dashboard';
import { formatFinancialDate } from '@/lib/dates/financial-date';
import { MoneyAmount } from './MoneyAmount';
import { EmptyState } from '@/components/shell/EmptyState';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function RecentTransactions({
  transactions,
}: {
  transactions: DashboardResponse['recent_transactions'];
}) {
  if (!transactions.length)
    return (
      <EmptyState
        title="No hay movimientos confirmados"
        description="Aquí aparecerán tus últimos 10 movimientos, sin depender del periodo."
      />
    );

  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-row items-center justify-between gap-3 border-b">
        <div className="min-w-0">
          <CardTitle>Movimientos recientes</CardTitle>
          <CardDescription>Tus últimos 10 movimientos confirmados.</CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm" className="shrink-0">
          <Link href="/dashboard/transactions">Ver todos</Link>
        </Button>
      </CardHeader>
      <ul className="divide-y divide-border">
        {transactions.map((transaction) => (
          <li
            key={transaction.id}
            className="grid min-w-0 gap-2 p-5 sm:grid-cols-[7rem_1fr_auto] sm:items-center"
          >
            <time className="text-sm text-muted-foreground">
              {formatFinancialDate(transaction.date)}
            </time>
            <div className="min-w-0">
              <p className="break-words font-medium">{transaction.description}</p>
              <p className="break-words text-sm text-muted-foreground">
                {transaction.account.name} · {transaction.category?.name ?? 'Sin categoría'}
              </p>
            </div>
            <MoneyAmount
              amount={transaction.amount}
              sign={transaction.kind === 'income' ? 'positive' : 'negative'}
              className={transaction.kind === 'income' ? 'text-income' : 'text-expense'}
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}
