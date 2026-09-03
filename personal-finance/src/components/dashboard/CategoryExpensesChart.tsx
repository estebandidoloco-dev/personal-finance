'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { formatMoney } from '@/lib/money-format';

interface CategoryExpense {
  name: string;
  amount: number;
  color: string | null;
}

interface CategoryExpensesChartProps {
  data: CategoryExpense[];
  currency: string;
}

interface CustomTooltipPayload {
  value?: number;
  name?: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: CustomTooltipPayload[];
  currency?: string;
}

function CustomTooltip({ active, payload, currency = 'MXN' }: CustomTooltipProps) {
  if (active && payload && payload.length) {
    const entry = payload[0];
    return (
      <div className="rounded bg-gray-900 p-3 text-white">
        <span className="font-mono">{formatMoney(entry.value || 0, currency)}</span>
      </div>
    );
  }
  return null;
}

export function CategoryExpensesChart({ data, currency }: CategoryExpensesChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="rounded-lg border bg-white p-8 text-center dark:bg-gray-800">
        <p className="text-gray-600 dark:text-gray-400">No hay gastos registrados</p>
      </div>
    );
  }

  const chartData = data.slice(0, 10).map((cat) => ({
    name: cat.name.length > 15 ? `${cat.name.slice(0, 12)}...` : cat.name,
    amount: cat.amount,
    fullName: cat.name,
    color: cat.color || '#94a3b8',
  }));

  return (
    <div className="rounded-lg border bg-white p-4 dark:bg-gray-800">
      <h3 className="mb-4 font-semibold">Gastos por categoría - {currency}</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, left: 150, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" tick={{ fontSize: 12 }} />
          <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={140} />
          <Tooltip content={<CustomTooltip currency={currency} />} />
          <Bar dataKey="amount" fill="#8b5cf6" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
