import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { DeleteAccountButton } from '@/components/ui/DeleteAccountButton';
import { EditAccountButton } from '@/components/ui/EditAccountButton';
import { LogoutButton } from '@/components/ui/LogoutButton';
import { Upload } from 'lucide-react';

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: accounts, error: accountsError } = await supabase
    .from('accounts')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  const accountsList = accounts ?? [];

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <h1 className="text-2xl font-bold">Cuentas</h1>
        <Link
          href="/dashboard/accounts/new"
          className="rounded bg-blue-600 px-4 py-2 text-center text-white hover:bg-blue-700"
        >
          + Nueva cuenta
        </Link>
        <Link
          href="/dashboard/import"
          className="flex items-center justify-center gap-2 rounded bg-gray-600 px-4 py-2 text-white hover:bg-gray-700"
        >
          <Upload className="h-4 w-4" /> Importar CSV
        </Link>
        <Link href="/dashboard/categories" className="rounded border px-4 py-2 text-center hover:bg-gray-50 dark:hover:bg-gray-700">
          Categorías
        </Link>
        <Link href="/dashboard/tags" className="rounded border px-4 py-2 text-center hover:bg-gray-50 dark:hover:bg-gray-700">
          Etiquetas
        </Link>
      </div>

      <div className="mb-4">
        <LogoutButton />
      </div>

      {accountsError && (
        <div className="mb-4 rounded bg-red-100 p-3 text-sm text-red-700">
          No se pudieron cargar las cuentas. Actualiza la página para intentarlo de nuevo.
        </div>
      )}

      {!accountsError && accountsList.length === 0 ? (
        <div className="py-12 text-center text-gray-500">
          <p className="mb-4">No hay cuentas aún</p>
          <Link href="/dashboard/accounts/new" className="text-blue-600 hover:underline">
            Crea tu primera cuenta
          </Link>
        </div>
      ) : !accountsError ? (
        <ul className="space-y-2">
          {accountsList.map((acc) => (
            <li
              key={acc.id}
              className="flex items-center justify-between rounded-lg border bg-white p-4 dark:bg-gray-800"
            >
              <div>
                <p className="font-medium">{acc.name}</p>
                <p className="text-sm text-gray-500">
                  {acc.type} •{' '}
                  {(acc.balance ?? 0).toLocaleString('es-MX', {
                    style: 'currency',
                    currency: acc.currency,
                  })}
                  {acc.is_shared && ' 👥'}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <EditAccountButton
                  account={{
                    id: acc.id,
                    name: acc.name,
                    type: acc.type,
                    currency: acc.currency,
                    institution: acc.institution,
                    is_shared: acc.is_shared,
                  }}
                />
                <DeleteAccountButton accountId={acc.id} />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
