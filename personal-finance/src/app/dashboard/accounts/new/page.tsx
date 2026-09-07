import Link from 'next/link';
import { PersonalAccountForm } from '@/components/accounts/PersonalAccountForm';
import { ContextBadge } from '@/components/shell/ContextBadge';
import { ArrowLeft } from 'lucide-react';

export default function NewAccountPage() {
  return (
    <main className="mx-auto w-full max-w-2xl min-w-0 space-y-5">
      <header>
        <ContextBadge />
        <h1 className="mt-2 text-3xl font-bold">Crear cuenta</h1>
        <p className="text-text-muted mt-1">Todos los importes se registran en MXN.</p>
      </header>
      <PersonalAccountForm />
      <Link
        href="/dashboard/accounts"
        className="text-primary inline-flex min-h-11 items-center gap-2 text-sm font-medium hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Volver a cuentas
      </Link>
    </main>
  );
}
