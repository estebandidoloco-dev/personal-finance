'use client';

import { useState, useEffect } from 'react';
import { useSupabase } from '@/components/providers/supabase-provider';
import { TransactionForm } from '@/components/transactions/TransactionForm';
import { Plus, Calendar } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

interface Transaction {
  id: string;
  amount: number;
  currency: string;
  kind: 'income' | 'expense';
  status: 'pending' | 'posted' | 'cancelled' | 'duplicate';
  date: string;
  description: string;
  notes: string | null;
  is_shared: boolean;
  category: {
    id: string;
    name: string;
    icon: string | null;
    color: string | null;
    type: string;
  } | null;
  tags: Array<{ tag: { id: string; name: string; color: string | null } }>;
  account_id: string;
}

export default function TransactionsPage() {
  const { supabase } = useSupabase();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [newKind, setNewKind] = useState<'income' | 'expense'>('expense');
  const [filters, setFilters] = useState({
    start_date: '',
    end_date: '',
    category_id: '',
    account_id: '',
  });
  const [page, setPage] = useState(0);
  const pageSize = 20;
  const [hasMore, setHasMore] = useState(true);
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([]);
  const [categories, setCategories] = useState<Array<{ id: string; name: string; type: string }>>(
    []
  );

  const fetchTransactions = async (reset = false, targetPage = reset ? 0 : page) => {
    setLoading(true);
    setPageError('');
    const params = new URLSearchParams();
    if (filters.start_date) params.set('start_date', filters.start_date);
    if (filters.end_date) params.set('end_date', filters.end_date);
    if (filters.category_id) params.set('category_id', filters.category_id);
    if (filters.account_id) params.set('account_id', filters.account_id);
    params.set('limit', String(pageSize));
    params.set('offset', String(targetPage * pageSize));

    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      setPageError('Tu sesión no está disponible. Vuelve a iniciar sesión.');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/transactions?${params}`);
      if (!res.ok) {
        const result = (await res.json().catch(() => null)) as { error?: string } | null;
        setPageError(result?.error || 'No se pudieron cargar las transacciones.');
        return;
      }

      const newTx = (await res.json()) as Transaction[];
      setTransactions((prev) => (reset ? newTx : [...prev, ...newTx]));
      setHasMore(newTx.length === pageSize);
      setPage(targetPage);
    } catch {
      setPageError('No se pudo conectar con el servidor. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const fetchMetadata = async () => {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      setPageError('Tu sesión no está disponible. Vuelve a iniciar sesión.');
      return;
    }
    const [accRes, catRes] = await Promise.all([
      supabase.from('accounts').select('id, name').eq('user_id', user.id).order('name'),
      supabase
        .from('categories')
        .select('id, name, type')
        .or(`user_id.eq.${user.id},user_id.is.null`)
        .order('name'),
    ]);
    if (accRes.error || catRes.error) {
      setPageError('No se pudieron cargar las cuentas o categorías.');
      return;
    }
    setAccounts(accRes.data ?? []);
    setCategories(catRes.data ?? []);
  };

  useEffect(() => {
    // These functions synchronize server-backed state after a filter change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchMetadata();
    void fetchTransactions(true, 0);
    // The callbacks intentionally use the current filter/page snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar transacción?')) return;
    setPageError('');
    try {
      const res = await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const result = (await res.json().catch(() => null)) as { error?: string } | null;
        setPageError(result?.error || 'No se pudo eliminar la transacción.');
        return;
      }
      await fetchTransactions(true, 0);
    } catch {
      setPageError('No se pudo conectar con el servidor. Inténtalo de nuevo.');
    }
  };

  const formatAmount = (
    amount: number,
    currency: string,
    kind: 'income' | 'expense',
    status: Transaction['status']
  ) => {
    const signedAmount = kind === 'income' ? amount : -amount;
    const color =
      status !== 'posted' ? 'text-gray-500' : kind === 'income' ? 'text-green-600' : 'text-red-600';
    const sign = signedAmount >= 0 ? '+' : '';
    return (
      <span className={`font-mono ${color}`}>
        {sign}
        {signedAmount.toLocaleString('es-MX', { style: 'currency', currency })}
        {status !== 'posted' && ` (${status})`}
      </span>
    );
  };

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Transacciones</h1>
          <p className="text-gray-500">{transactions.length} movimientos</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              setNewKind('expense');
              setShowForm(true);
            }}
            className="flex items-center gap-2 rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700"
          >
            <Plus className="h-4 w-4" /> Nuevo gasto
          </button>
          <button
            onClick={() => {
              setNewKind('income');
              setShowForm(true);
            }}
            className="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> Nuevo ingreso
          </button>
        </div>
      </div>

      {/* Filtros */}
      {pageError && (
        <div className="mb-4 rounded bg-red-100 p-3 text-sm text-red-700">{pageError}</div>
      )}

      <div className="mb-6 flex flex-wrap gap-4 rounded-lg border bg-white p-4 dark:bg-gray-800">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-gray-400" />
          <input
            type="date"
            value={filters.start_date}
            onChange={(e) => setFilters({ ...filters, start_date: e.target.value })}
            className="rounded-md border px-3 py-2 text-sm"
          />
          <span className="text-gray-400">a</span>
          <input
            type="date"
            value={filters.end_date}
            onChange={(e) => setFilters({ ...filters, end_date: e.target.value })}
            className="rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <select
          value={filters.category_id}
          onChange={(e) => setFilters({ ...filters, category_id: e.target.value })}
          className="rounded-md border px-3 py-2 text-sm"
        >
          <option value="">Todas las categorías</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={filters.account_id}
          onChange={(e) => setFilters({ ...filters, account_id: e.target.value })}
          className="rounded-md border px-3 py-2 text-sm"
        >
          <option value="">Todas las cuentas</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      {/* Lista */}
      <div className="overflow-hidden rounded-lg border bg-white dark:bg-gray-800">
        {loading && transactions.length === 0 ? (
          <div className="p-12 text-center text-gray-500">Cargando...</div>
        ) : transactions.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <p className="mb-4">No hay transacciones</p>
            <button onClick={() => setShowForm(true)} className="text-blue-600 hover:underline">
              Crear la primera
            </button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="p-3 text-left text-sm font-medium text-gray-500">Fecha</th>
                    <th className="p-3 text-left text-sm font-medium text-gray-500">Descripción</th>
                    <th className="p-3 text-left text-sm font-medium text-gray-500">Categoría</th>
                    <th className="p-3 text-right text-sm font-medium text-gray-500">Importe</th>
                    <th className="p-3 text-right text-sm font-medium text-gray-500">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="p-3 text-sm whitespace-nowrap">
                        {format(parseISO(tx.date), 'dd/MM/yyyy', { locale: es })}
                      </td>
                      <td className="p-3 text-sm">
                        <p className="font-medium">{tx.description}</p>
                        {tx.notes && <p className="text-xs text-gray-500">{tx.notes}</p>}
                        {tx.tags.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {tx.tags.map(({ tag }) => (
                              <span
                                key={tag.name}
                                className="rounded bg-gray-100 px-1.5 py-0.5 text-xs dark:bg-gray-700"
                                style={{
                                  backgroundColor: `${tag.color ?? '#6b7280'}20`,
                                  color: tag.color ?? undefined,
                                }}
                              >
                                {tag.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-sm">
                        {tx.category && (
                          <span
                            className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium"
                            style={{
                              backgroundColor: `${tx.category.color ?? '#6b7280'}20`,
                              color: tx.category.color ?? undefined,
                            }}
                          >
                            {tx.category.icon && <span>📁</span>}
                            {tx.category.name}
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right font-mono text-sm">
                        {formatAmount(tx.amount, tx.currency, tx.kind, tx.status)}
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {tx.is_shared && (
                            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                              Compartido
                            </span>
                          )}
                          <button
                            onClick={() => {
                              setEditingTx(tx);
                              setShowForm(true);
                            }}
                            className="text-sm text-blue-600 hover:underline"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => handleDelete(tx.id)}
                            className="text-sm text-red-600 hover:underline"
                          >
                            Eliminar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Paginación */}
            {hasMore && (
              <div className="border-t p-4 text-center">
                <button
                  onClick={() => {
                    const nextPage = page + 1;
                    void fetchTransactions(false, nextPage);
                  }}
                  disabled={loading}
                  className="rounded bg-blue-600 px-6 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Cargar más
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modales */}
      {showForm && (
        <TransactionForm
          onClose={() => {
            setShowForm(false);
            setEditingTx(null);
          }}
          onSuccess={() => fetchTransactions(true, 0)}
          defaultKind={newKind}
          initialData={
            editingTx
              ? {
                  id: editingTx.id,
                  account_id: editingTx.account_id,
                  category_id: editingTx.category?.id,
                  kind: editingTx.kind,
                  amount: editingTx.amount,
                  currency: editingTx.currency,
                  date: editingTx.date,
                  description: editingTx.description,
                  notes: editingTx.notes || undefined,
                  is_shared: editingTx.is_shared,
                  status: editingTx.status,
                  tag_ids: editingTx.tags.map(({ tag }) => tag.id),
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
