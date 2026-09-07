import { compareExactMoney } from '@/lib/money/exact-money';
import { MoneyAmount } from './MoneyAmount';

export function SummaryCards({ totalBalance, income, expense, net }: { totalBalance: string; income: string; expense: string; net: string }) {
  const positiveNet = compareExactMoney(net, '0.00') >= 0;
  return <section className="space-y-4">
    <article className="surface-enter w-full min-w-0 rounded-2xl border bg-surface-raised p-5 sm:p-6">
      <p className="text-sm font-medium text-text-muted">Saldo actual</p>
      <MoneyAmount amount={totalBalance} className="mt-2 block text-3xl font-bold tracking-tight sm:text-4xl" />
      <p className="mt-2 text-sm text-text-muted">No cambia al seleccionar otro periodo.</p>
    </article>
    <div className="grid w-full min-w-0 gap-4 rounded-2xl bg-surface-subtle p-4 sm:grid-cols-3 sm:p-5">
      <Metric label="Ingresos" amount={income} tone="income" sign="positive" />
      <Metric label="Gastos" amount={expense} tone="expense" sign="negative" />
      <Metric label="Resultado" amount={net} tone={positiveNet ? 'income' : 'expense'} sign={positiveNet ? 'positive' : undefined} />
    </div>
  </section>;
}

function Metric({ label, amount, tone, sign }: { label: string; amount: string; tone: 'income' | 'expense'; sign?: 'positive' | 'negative' }) {
  return <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</p><MoneyAmount amount={amount} sign={sign} className={`mt-1 block break-words text-lg font-semibold ${tone === 'income' ? 'text-income' : 'text-expense'}`} /></div>;
}
