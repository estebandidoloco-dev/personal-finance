'use client';

import Link from 'next/link';
import { Upload } from 'lucide-react';

export function DashboardNav() {
  return (
    <nav className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
      <Link
        href="/dashboard/accounts/new"
        className="rounded bg-blue-600 px-4 py-2 text-center text-sm text-white hover:bg-blue-700"
      >
        + Nueva cuenta
      </Link>
      <Link
        href="/dashboard/import"
        className="flex items-center justify-center gap-2 rounded bg-gray-600 px-4 py-2 text-sm text-white hover:bg-gray-700"
      >
        <Upload className="h-4 w-4" /> Importar CSV
      </Link>
      <Link
        href="/dashboard/transactions"
        className="rounded border border-gray-300 px-4 py-2 text-center text-sm hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
      >
        Transacciones
      </Link>
      <Link
        href="/dashboard/categories"
        className="rounded border border-gray-300 px-4 py-2 text-center text-sm hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
      >
        Categorías
      </Link>
      <Link
        href="/dashboard/tags"
        className="rounded border border-gray-300 px-4 py-2 text-center text-sm hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
      >
        Etiquetas
      </Link>
    </nav>
  );
}
