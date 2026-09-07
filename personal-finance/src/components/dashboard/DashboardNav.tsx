'use client';

import Link from 'next/link';
import { Upload } from 'lucide-react';

export function DashboardNav() {
  return (
    <nav className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
      <Link
        href="/dashboard/accounts/new"
        className="min-h-11 rounded-xl bg-primary px-4 py-2 text-center text-sm text-on-primary hover:bg-primary-hover"
      >
        + Nueva cuenta
      </Link>
      <Link
        href="/dashboard/import"
        className="flex min-h-11 items-center justify-center gap-2 rounded-xl border bg-surface px-4 py-2 text-sm hover:bg-surface-subtle"
      >
        <Upload className="h-4 w-4" /> Importar CSV
      </Link>
      <Link
        href="/dashboard/transactions"
        className="min-h-11 rounded-xl border bg-surface px-4 py-2 text-center text-sm hover:bg-surface-subtle"
      >
        Transacciones
      </Link>
      <Link
        href="/dashboard/categories"
        className="min-h-11 rounded-xl border bg-surface px-4 py-2 text-center text-sm hover:bg-surface-subtle"
      >
        Categorías
      </Link>
      <Link
        href="/dashboard/tags"
        className="min-h-11 rounded-xl border bg-surface px-4 py-2 text-center text-sm hover:bg-surface-subtle"
      >
        Etiquetas
      </Link>
    </nav>
  );
}
