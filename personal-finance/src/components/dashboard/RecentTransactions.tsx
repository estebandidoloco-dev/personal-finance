import Link from 'next/link';
import type { DashboardResponse } from '@/lib/validation/dashboard';
import { formatFinancialDate } from '@/lib/dates/financial-date';
import { MoneyAmount } from './MoneyAmount';
import { EmptyState } from '@/components/shell/EmptyState';

export function RecentTransactions({ transactions }: { transactions: DashboardResponse['recent_transactions'] }) {
  if (!transactions.length) return <EmptyState title="No hay movimientos confirmados" description="Aquí aparecerán tus últimos 10 movimientos, sin depender del periodo." />;
  return <section className="min-w-0 rounded-2xl border bg-surface"><div className="flex min-w-0 items-center justify-between gap-3 border-b p-5"><div className="min-w-0"><h2 className="font-semibold">Movimientos recientes</h2><p className="text-sm text-text-muted">Tus últimos 10 movimientos confirmados.</p></div><Link href="/dashboard/transactions" className="shrink-0 text-sm font-medium text-primary hover:underline">Ver todos</Link></div><ul className="divide-y">{transactions.map((transaction) => <li key={transaction.id} className="grid min-w-0 gap-2 p-5 sm:grid-cols-[7rem_1fr_auto] sm:items-center"><time className="text-sm text-text-muted">{formatFinancialDate(transaction.date)}</time><div className="min-w-0"><p className="break-words font-medium">{transaction.description}</p><p className="break-words text-sm text-text-muted">{transaction.account.name} · {transaction.category?.name ?? 'Sin categoría'}</p></div><MoneyAmount amount={transaction.amount} sign={transaction.kind === 'income' ? 'positive' : 'negative'} className={transaction.kind === 'income' ? 'text-income' : 'text-expense'} /></li>)}</ul></section>;
}
