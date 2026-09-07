import Link from 'next/link';
import type { DashboardResponse } from '@/lib/validation/dashboard';
import { accountTypeLabel } from '@/lib/household/presentation';
import { MoneyAmount } from './MoneyAmount';
import { EmptyState } from '@/components/shell/EmptyState';

export function AccountsSummary({ accounts }: { accounts: DashboardResponse['accounts'] }) {
  if (!accounts.length)
    return (
      <EmptyState
        title="Aún no tienes cuentas"
        action={
          <Link
            href="/dashboard/accounts/new"
            className="font-medium text-primary hover:underline"
          >
            Crear tu primera cuenta
          </Link>
        }
      />
    );
  return (
    <section className="w-full min-w-0 rounded-2xl border bg-surface">
      <div className="border-b p-5">
        <h2 className="font-semibold">Cuentas personales</h2>
        <p className="text-sm text-text-muted">Saldo actual, independiente del periodo.</p>
      </div>
      <ul className="divide-y">
        {accounts.map((account) => (
          <li key={account.id} className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <p className="font-medium">{account.name}</p>
              <p className="text-sm text-text-muted">{accountTypeLabel(account.type)}</p>
            </div>
            <MoneyAmount amount={account.balance} className="font-semibold" />
          </li>
        ))}
      </ul>
    </section>
  );
}
