'use client';

import { formatMoney } from '@/lib/money-format';

interface Account {
  id: string;
  name: string;
  type: string;
  balance: number;
  currency: string;
}

interface AccountsSummaryProps {
  accounts: Account[];
}

export function AccountsSummary({ accounts }: AccountsSummaryProps) {
  if (accounts.length === 0) {
    return (
      <div className="rounded-lg border bg-white p-8 text-center dark:bg-gray-800">
        <p className="mb-4 text-gray-600 dark:text-gray-400">Aún no tienes cuentas</p>
        <a href="/dashboard/accounts/new" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
          Crear tu primera cuenta
        </a>
      </div>
    );
  }

  const typeLabels: Record<string, string> = {
    checking: 'Corriente',
    savings: 'Ahorros',
    credit: 'Crédito',
    cash: 'Efectivo',
    investment: 'Inversión',
    other: 'Otro',
  };

  return (
    <div className="rounded-lg border bg-white dark:bg-gray-800">
      <div className="border-b p-4">
        <h3 className="font-semibold">Mis cuentas</h3>
      </div>
      <ul className="divide-y">
        {accounts.map((account) => (
          <li key={account.id} className="flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50">
            <div>
              <p className="font-medium">{account.name}</p>
              <p className="text-sm text-gray-500">{typeLabels[account.type as keyof typeof typeLabels] || account.type}</p>
            </div>
            <p className="font-mono font-semibold">{formatMoney(account.balance, account.currency)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
