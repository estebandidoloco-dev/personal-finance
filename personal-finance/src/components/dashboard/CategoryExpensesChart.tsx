'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DashboardResponse } from '@/lib/validation/dashboard';
import { approximateMoneyForChart, moneySeriesIsChartSafe } from '@/lib/money/chart-money';
import { formatMxn } from '@/lib/money/format-mxn';
import { EmptyState } from '@/components/shell/EmptyState';
import { Card, CardTitle } from '@/components/ui/card';

type Category = DashboardResponse['expenses_by_category'][number];

export function CategoryExpensesChart({ data }: { data: Category[] }) {
  if (!data.length)
    return (
      <EmptyState
        title="Sin gastos en el periodo"
        description="No hay gastos confirmados para agrupar por categoría."
      />
    );

  const safe = moneySeriesIsChartSafe(data.map((item) => item.amount));
  if (!safe)
    return (
      <Card className="w-full min-w-0 p-5 sm:p-6">
        <CardTitle className="mb-4">Gastos por categoría</CardTitle>
        <ul className="divide-y divide-border">
          {data.map((item) => (
            <li key={item.category_id ?? 'none'} className="flex justify-between gap-3 py-3">
              <span>{item.name}</span>
              <span className="break-words tabular-nums font-medium">{formatMxn(item.amount)}</span>
            </li>
          ))}
        </ul>
      </Card>
    );

  const chart = data
    .slice(0, 10)
    .map((item) => ({
      ...item,
      geometry: approximateMoneyForChart(item.amount),
      shortName: item.name.length > 13 ? `${item.name.slice(0, 12)}…` : item.name,
    }));

  return (
    <Card className="w-full min-w-0 p-5 sm:p-6">
      <CardTitle className="mb-4">Gastos por categoría</CardTitle>
      <div className="h-72 w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chart} layout="vertical" margin={{ left: 24 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis type="number" tick={{ fill: 'var(--text-muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} />
            <YAxis dataKey="shortName" type="category" width={100} tick={{ fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} />
            <Tooltip
              content={({ active, payload }) => {
                const item = payload?.[0]?.payload as (typeof chart)[number] | undefined;
                return active && item ? (
                  <Card className="p-3 text-sm shadow-lg">
                    <p className="font-semibold">{item.name}</p>
                    <p className="text-muted-foreground">{formatMxn(item.amount)}</p>
                  </Card>
                ) : null;
              }}
            />
            <Bar dataKey="geometry" fill="var(--primary)" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
