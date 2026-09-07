'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DashboardResponse } from '@/lib/validation/dashboard';
import { approximateMoneyForChart, moneySeriesIsChartSafe } from '@/lib/money/chart-money';
import { formatMxn } from '@/lib/money/format-mxn';
import { EmptyState } from '@/components/shell/EmptyState';

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
      <section className="w-full min-w-0 rounded-2xl border bg-surface p-5">
        <h2 className="font-semibold">Gastos por categoría</h2>
        <ul className="mt-4 divide-y">
          {data.map((item) => (
            <li key={item.category_id ?? 'none'} className="flex justify-between gap-3 py-3">
              <span>{item.name}</span>
              <span className="break-words tabular-nums">{formatMxn(item.amount)}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  const chart = data
    .slice(0, 10)
    .map((item) => ({
      ...item,
      geometry: approximateMoneyForChart(item.amount),
      shortName: item.name.length > 13 ? `${item.name.slice(0, 12)}…` : item.name,
    }));
  return (
    <section className="w-full min-w-0 rounded-2xl border bg-surface p-5">
      <h2 className="font-semibold">Gastos por categoría</h2>
      <div className="mt-4 h-72 w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chart} layout="vertical" margin={{ left: 24 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis type="number" tick={{ fill: 'var(--text-muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} />
            <YAxis dataKey="shortName" type="category" width={100} tick={{ fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} />
            <Tooltip
              content={({ active, payload }) => {
                const item = payload?.[0]?.payload as (typeof chart)[number] | undefined;
                return active && item ? (
                  <div className="rounded-xl border bg-surface-raised p-3 text-sm text-text shadow-lg">
                    <p>{item.name}</p>
                    <p>{formatMxn(item.amount)}</p>
                  </div>
                ) : null;
              }}
            />
            <Bar dataKey="geometry" fill="var(--primary)" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
