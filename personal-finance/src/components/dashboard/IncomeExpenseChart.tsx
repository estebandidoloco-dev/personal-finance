'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { formatMoneyNoSymbol } from '@/lib/money-format';

interface TimeSeriesPoint {
  date: string;
  income: number;
  expense: number;
  net: number;
}

interface IncomeExpenseChartProps {
  data: TimeSeriesPoint[];
  currency: string;
}

interface CustomTooltipPayload {
  value?: number;
  name?: string;
  color?: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: CustomTooltipPayload[];
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (active && payload && payload.length) {
    return (
      <div className="rounded bg-gray-900 p-3 text-white">
        {payload.map((entry, index) => (
          <div key={index} style={{ color: entry.color }}>
            <span>{entry.name}: </span>
            <span className="font-mono">{formatMoneyNoSymbol(entry.value || 0, 2)}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
}

export function IncomeExpenseChart({ data, currency }: IncomeExpenseChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="rounded-lg border bg-white p-8 text-center dark:bg-gray-800">
        <p className="text-gray-600 dark:text-gray-400">No hay movimientos en este período</p>
      </div>
    );
  }

  const chartData = data.map((point) => ({
    date: point.date.slice(5),
    income: point.income,
    expense: point.expense,
  }));

  return (
    <div className="rounded-lg border bg-white p-4 dark:bg-gray-800">
      <h3 className="mb-4 font-semibold">Ingresos vs Gastos - {currency}</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} />
          <YAxis
            tick={{ fontSize: 12 }}
            tickFormatter={(value) => formatMoneyNoSymbol(value as number, 0)}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          <Bar dataKey="income" fill="#10b981" name="Ingresos" />
          <Bar dataKey="expense" fill="#ef4444" name="Gastos" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
