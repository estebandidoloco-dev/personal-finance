'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DashboardResponse } from '@/lib/validation/dashboard';
import { approximateMoneyForChart, moneySeriesIsChartSafe } from '@/lib/money/chart-money';
import { formatFinancialDate } from '@/lib/dates/financial-date';
import { formatMxn } from '@/lib/money/format-mxn';

type Point = DashboardResponse['time_series']['points'][number];

export function IncomeExpenseChart({ data }: { data: Point[] }) {
  const safe = moneySeriesIsChartSafe(data.flatMap((point) => [point.income, point.expense]));
  if (!safe)
    return (
      <section className="w-full min-w-0 rounded-2xl border bg-surface p-5">
        <h2 className="font-semibold">Ingresos y gastos diarios</h2>
        <p className="mt-1 text-sm text-text-muted">
          Vista exacta — el rango es demasiado grande para una gráfica fiable.
        </p>
        <div className="mt-4 max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="py-2 text-left">Fecha</th>
                <th className="text-right">Ingresos</th>
                <th className="text-right">Gastos</th>
              </tr>
            </thead>
            <tbody>
              {data.map((point) => (
                <tr key={point.date} className="border-t">
                  <td className="py-2">{formatFinancialDate(point.date)}</td>
                  <td className="text-right tabular-nums">{formatMxn(point.income)}</td>
                  <td className="text-right tabular-nums">{formatMxn(point.expense)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  const chart = data.map((point) => ({
    ...point,
    incomeGeometry: approximateMoneyForChart(point.income),
    expenseGeometry: approximateMoneyForChart(point.expense),
  }));
  return (
    <section className="w-full min-w-0 rounded-2xl border bg-surface p-5">
      <h2 className="font-semibold">Ingresos y gastos diarios</h2>
      <div className="mt-4 h-72 w-full min-w-0" aria-label="Gráfica diaria de ingresos y gastos">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chart}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fill: 'var(--text-muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} tickFormatter={(value: string) => value.slice(5)} />
            <YAxis width={48} tick={{ fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} />
            <Tooltip
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as (typeof chart)[number] | undefined;
                return active && point ? (
                  <div className="rounded-xl border bg-surface-raised p-3 text-sm text-text shadow-lg">
                    <p>{formatFinancialDate(point.date)}</p>
                    <p>Ingresos: {formatMxn(point.income)}</p>
                    <p>Gastos: {formatMxn(point.expense)}</p>
                  </div>
                ) : null;
              }}
            />
            <Area
              type="monotone"
              dataKey="incomeGeometry"
              stroke="var(--income)"
              fill="var(--success-soft)"
              name="Ingresos"
            />
            <Area
              type="monotone"
              dataKey="expenseGeometry"
              stroke="var(--expense)"
              fill="var(--danger-soft)"
              name="Gastos"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
