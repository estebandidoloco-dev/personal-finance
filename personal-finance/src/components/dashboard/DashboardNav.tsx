'use client';

import Link from 'next/link';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function DashboardNav() {
  return (
    <nav className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
      <Button asChild size="default">
        <Link href="/dashboard/accounts/new">+ Nueva cuenta</Link>
      </Button>
      <Button asChild variant="outline" size="default">
        <Link href="/dashboard/import">
          <Upload className="h-4 w-4" /> Importar CSV
        </Link>
      </Button>
      <Button asChild variant="outline" size="default">
        <Link href="/dashboard/transactions">Transacciones</Link>
      </Button>
      <Button asChild variant="outline" size="default">
        <Link href="/dashboard/categories">Categorías</Link>
      </Button>
      <Button asChild variant="outline" size="default">
        <Link href="/dashboard/tags">Etiquetas</Link>
      </Button>
    </nav>
  );
}
