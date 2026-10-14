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
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';

type Point = DashboardResponse['time_series']['points'][number];

export function IncomeExpenseChart({ data }: { data: Point[] }) {
  const safe = moneySeriesIsChartSafe(data.flatMap((point) => [point.income, point.expense]));
  if (!safe)
    return (
      <Card className="w-full min-w-0">
        <CardHeader>
          <CardTitle>Ingresos y gastos diarios</CardTitle>
          <CardDescription>
            Vista exacta — el rango es demasiado grande para una gráfica fiable.
          </CardDescription>
        </CardHeader>
        <CardContent className="max-h-80 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead className="text-right">Ingresos</TableHead>
                <TableHead className="text-right">Gastos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((point) => (
                <TableRow key={point.date}>
                  <TableCell>{formatFinancialDate(point.date)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMxn(point.income)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMxn(point.expense)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );

  const chart = data.map((point) => ({
    ...point,
    incomeGeometry: approximateMoneyForChart(point.income),
    expenseGeometry: approximateMoneyForChart(point.expense),
  }));

  return (
    <Card className="w-full min-w-0 p-5 sm:p-6">
      <CardTitle className="mb-4">Ingresos y gastos diarios</CardTitle>
      <div className="h-72 w-full min-w-0" aria-label="Gráfica diaria de ingresos y gastos">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chart}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tick={{ fill: 'var(--text-muted)' }}
              tickLine={false}
              axisLine={{ stroke: 'var(--border)' }}
              tickFormatter={(value: string) => value.slice(5)}
            />
            <YAxis width={48} tick={{ fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} />
            <Tooltip
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as (typeof chart)[number] | undefined;
                return active && point ? (
                  <Card className="p-3 text-sm shadow-lg">
                    <p className="font-semibold">{formatFinancialDate(point.date)}</p>
                    <p className="text-income">Ingresos: {formatMxn(point.income)}</p>
                    <p className="text-expense">Gastos: {formatMxn(point.expense)}</p>
                  </Card>
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
    </Card>
  );
}
