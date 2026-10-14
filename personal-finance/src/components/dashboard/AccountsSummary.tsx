import Link from 'next/link';
import type { DashboardResponse } from '@/lib/validation/dashboard';
import { accountTypeLabel } from '@/lib/household/presentation';
import { MoneyAmount } from './MoneyAmount';
import { EmptyState } from '@/components/shell/EmptyState';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function AccountsSummary({ accounts }: { accounts: DashboardResponse['accounts'] }) {
  if (!accounts.length)
    return (
      <EmptyState
        title="Aún no tienes cuentas"
        action={
          <Button asChild variant="link">
            <Link href="/dashboard/accounts/new">
              Crear tu primera cuenta
            </Link>
          </Button>
        }
      />
    );
  return (
    <Card className="w-full min-w-0">
      <CardHeader className="border-b">
        <CardTitle>Cuentas personales</CardTitle>
        <CardDescription>Saldo actual, independiente del periodo.</CardDescription>
      </CardHeader>
      <ul className="divide-y divide-border">
        {accounts.map((account) => (
          <li key={account.id} className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <p className="font-medium">{account.name}</p>
              <p className="text-sm text-muted-foreground">{accountTypeLabel(account.type)}</p>
            </div>
            <MoneyAmount amount={account.balance} className="font-semibold" />
          </li>
        ))}
      </ul>
    </Card>
  );
}
