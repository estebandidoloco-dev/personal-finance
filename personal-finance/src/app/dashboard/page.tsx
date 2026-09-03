'use client';

import { useEffect, useState, useRef } from 'react';
import { DashboardPeriodSelector } from '@/components/dashboard/DashboardPeriodSelector';
import { DashboardNav } from '@/components/dashboard/DashboardNav';
import { SummaryCards } from '@/components/dashboard/SummaryCards';
import { AccountsSummary } from '@/components/dashboard/AccountsSummary';
import { IncomeExpenseChart } from '@/components/dashboard/IncomeExpenseChart';
import { CategoryExpensesChart } from '@/components/dashboard/CategoryExpensesChart';
import { RecentTransactions } from '@/components/dashboard/RecentTransactions';
import { formatMoney } from '@/lib/money-format';

interface DashboardData {
  period: {
    key: string;
    start_date: string;
    end_date_exclusive: string;
    timezone: string;
  };
  accounts: Array<{ id: string; name: string; type: string; balance: number; currency: string; created_at: string }>;
  balances_by_currency: Array<{ currency: string; balance: number }>;
  totals: {
    total_balance: number | null;
    currency: string | null;
    income: number | null;
    expense: number | null;
    net: number | null;
  };
  period_totals_by_currency: Array<{ currency: string; income: number; expense: number; net: number }>;
  expenses_by_category: Array<{ category_id: string | null; name: string; color: string | null; is_uncategorized: boolean; currency: string; amount: number }>;
  time_series: Array<{ currency: string; points: Array<{ date: string; income: number; expense: number; net: number }> }>;
  recent_transactions: Array<{
    id: string;
    date: string;
    description: string;
    amount: number;
    kind: 'income' | 'expense';
    currency: string;
    category: { id: string; name: string; color: string | null } | null;
    account: { id: string; name: string };
  }>;
}

export default function DashboardPage() {
  const [period, setPeriod] = useState('this_month');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const loadDashboard = async () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      setLoading(true);
      setError('');
      try {
        const response = await fetch(`/api/dashboard?period=${period}`, {
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          setError('No se pudo cargar el dashboard. Intenta nuevamente.');
          return;
        }

        const result = (await response.json()) as DashboardData;
        setData(result);
        setSelectedCurrency(null);
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          setError('No se pudo conectar con el servidor. Intenta nuevamente.');
        }
      } finally {
        setLoading(false);
      }
    };

    void loadDashboard();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [period]);

  const handlePeriodChange = (newPeriod: string) => {
    setPeriod(newPeriod);
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-7xl p-4 sm:p-6">
        <div className="rounded-lg border bg-white p-12 text-center dark:bg-gray-800">
          <p className="text-gray-600 dark:text-gray-400">Cargando dashboard...</p>
        </div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="mx-auto max-w-7xl p-4 sm:p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 dark:bg-red-900/20 dark:border-red-900">
          <p className="text-red-800 dark:text-red-300">{error || 'Error al cargar el dashboard.'}</p>
          <button
            onClick={() => setPeriod(period)}
            className="mt-3 rounded bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700"
          >
            Reintentar
          </button>
        </div>
      </main>
    );
  }

  const isSingleCurrency = data.totals.total_balance !== null;
  const currencies = isSingleCurrency ? [data.totals.currency || 'MXN'] : data.period_totals_by_currency.map((t) => t.currency);
  const activeCurrency = selectedCurrency || currencies[0] || 'MXN';

  const activeTimeSeries =
    data.time_series.find((ts) => ts.currency === activeCurrency)?.points ||
    (data.time_series.length > 0 ? data.time_series[0].points : []);

  const activeExpensesByCategory = data.expenses_by_category.filter((cat) => cat.currency === activeCurrency);

  return (
    <main className="mx-auto max-w-7xl p-4 sm:p-6">
      <div className="mb-8 flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Dashboard Financiero</h1>
            <p className="mt-1 text-gray-600 dark:text-gray-400">Resumen de tu situación financiera</p>
          </div>
          <DashboardPeriodSelector value={period} onChange={handlePeriodChange} disabled={loading} />
        </div>
        <DashboardNav />
      </div>

      {!isSingleCurrency && currencies.length > 1 && (
        <div className="mb-6 flex gap-2">
          {currencies.map((curr) => (
            <button
              key={curr}
              onClick={() => setSelectedCurrency(curr)}
              className={`rounded px-4 py-2 text-sm font-medium transition ${
                activeCurrency === curr
                  ? 'bg-blue-600 text-white'
                  : 'border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700'
              }`}
              aria-pressed={activeCurrency === curr}
            >
              {curr}
            </button>
          ))}
        </div>
      )}

      {isSingleCurrency ? (
        <SummaryCards
          totalBalance={data.totals.total_balance}
          currency={data.totals.currency}
          income={data.totals.income || 0}
          expense={data.totals.expense || 0}
          net={data.totals.net || 0}
        />
      ) : (
        <div className="mb-8 rounded-lg border bg-white p-6 dark:bg-gray-800">
          <h2 className="mb-4 font-semibold">Saldos y movimientos por moneda</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.period_totals_by_currency.map((total) => (
              <div key={total.currency} className="rounded-lg border bg-gray-50 p-4 dark:bg-gray-700/50">
                <p className="mb-3 text-sm font-medium uppercase text-gray-600 dark:text-gray-400">{total.currency}</p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Saldo:</span>
                    <span className="font-mono font-medium">
                      {formatMoney(
                        data.balances_by_currency.find((b) => b.currency === total.currency)?.balance || 0,
                        total.currency
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between text-green-600">
                    <span>Ingresos:</span>
                    <span className="font-mono font-medium">{formatMoney(total.income, total.currency)}</span>
                  </div>
                  <div className="flex justify-between text-red-600">
                    <span>Gastos:</span>
                    <span className="font-mono font-medium">{formatMoney(total.expense, total.currency)}</span>
                  </div>
                  <div className={`border-t pt-2 font-bold ${total.net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    <div className="flex justify-between">
                      <span>Neto:</span>
                      <span className="font-mono">{formatMoney(total.net, total.currency)}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-8">
        <AccountsSummary accounts={data.accounts} />
      </div>

      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <IncomeExpenseChart data={activeTimeSeries} currency={activeCurrency} />
        <CategoryExpensesChart data={activeExpensesByCategory} currency={activeCurrency} />
      </div>

      <div className="mb-8">
        <RecentTransactions transactions={data.recent_transactions} />
      </div>
    </main>
  );
}
