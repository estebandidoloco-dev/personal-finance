'use client';

import { formatMoney } from '@/lib/money-format';

interface SummaryCardsProps {
  totalBalance: number | null;
  currency: string | null;
  income: number;
  expense: number;
  net: number;
}

export function SummaryCards({ totalBalance, currency, income, expense, net }: SummaryCardsProps) {
  const cards = [
    {
      label: 'Saldo actual',
      value: totalBalance,
      currency: currency || 'MXN',
      color: 'bg-blue-50 dark:bg-blue-900/20',
      textColor: 'text-blue-700 dark:text-blue-300',
    },
    {
      label: 'Ingresos',
      value: income,
      currency: currency || 'MXN',
      color: 'bg-green-50 dark:bg-green-900/20',
      textColor: 'text-green-700 dark:text-green-300',
    },
    {
      label: 'Gastos',
      value: expense,
      currency: currency || 'MXN',
      color: 'bg-red-50 dark:bg-red-900/20',
      textColor: 'text-red-700 dark:text-red-300',
    },
    {
      label: 'Balance neto',
      value: net,
      currency: currency || 'MXN',
      color: net >= 0 ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20',
      textColor: net >= 0 ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300',
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className={`rounded-lg ${card.color} border p-4`}>
          <p className="text-xs font-medium uppercase tracking-wider text-gray-600 dark:text-gray-400">{card.label}</p>
          <p className={`mt-2 text-lg font-bold ${card.textColor}`}>
            {card.value !== null && card.value !== undefined ? formatMoney(card.value, card.currency) : `${card.currency} 0.00`}
          </p>
        </div>
      ))}
    </div>
  );
}
