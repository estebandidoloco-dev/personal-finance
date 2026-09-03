'use client';

import { formatMoney } from '@/lib/money-format';
import { formatLocalDateShort } from '@/lib/date-format';

interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  kind: 'income' | 'expense';
  currency: string;
  category: { id: string; name: string; color: string | null } | null;
  account: { id: string; name: string };
}

interface RecentTransactionsProps {
  transactions: Transaction[];
}

export function RecentTransactions({ transactions }: RecentTransactionsProps) {
  if (!transactions || transactions.length === 0) {
    return (
      <div className="rounded-lg border bg-white p-8 text-center dark:bg-gray-800">
        <p className="mb-4 text-gray-600 dark:text-gray-400">No hay movimientos recientes</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <a href="/dashboard/transactions" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
            Ver todas las transacciones
          </a>
          <span className="hidden text-gray-400 sm:inline">•</span>
          <a href="/dashboard/import" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
            Importar CSV
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-white dark:bg-gray-800">
      <div className="border-b p-4">
        <h3 className="font-semibold">Movimientos recientes</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b bg-gray-50 dark:bg-gray-900">
            <tr>
              <th className="p-3 text-left text-xs font-medium uppercase text-gray-600 dark:text-gray-400">Fecha</th>
              <th className="p-3 text-left text-xs font-medium uppercase text-gray-600 dark:text-gray-400">Descripción</th>
              <th className="p-3 text-left text-xs font-medium uppercase text-gray-600 dark:text-gray-400">Categoría</th>
              <th className="p-3 text-left text-xs font-medium uppercase text-gray-600 dark:text-gray-400">Cuenta</th>
              <th className="p-3 text-right text-xs font-medium uppercase text-gray-600 dark:text-gray-400">Importe</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {transactions.map((tx) => (
              <tr key={tx.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <td className="whitespace-nowrap p-3 text-sm text-gray-600 dark:text-gray-400">
                  {formatLocalDateShort(tx.date)}
                </td>
                <td className="p-3 text-sm font-medium">{tx.description}</td>
                <td className="p-3 text-sm">
                  {tx.category ? (
                    <span
                      className="inline-block rounded px-2 py-1 text-xs"
                      style={{
                        backgroundColor: `${tx.category.color || '#94a3b8'}20`,
                        color: tx.category.color || '#64748b',
                      }}
                    >
                      {tx.category.name}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-500">Sin categoría</span>
                  )}
                </td>
                <td className="p-3 text-sm text-gray-600 dark:text-gray-400">{tx.account.name}</td>
                <td className={`p-3 text-right font-mono text-sm font-semibold ${tx.kind === 'income' ? 'text-green-600' : 'text-red-600'}`}>
                  {tx.kind === 'income' ? '+' : '-'}
                  {formatMoney(tx.amount, tx.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t p-4 text-center">
        <a href="/dashboard/transactions" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
          Ver todas las transacciones →
        </a>
      </div>
    </div>
  );
}
