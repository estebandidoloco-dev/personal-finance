import Link from 'next/link';
import { ContextBadge } from '@/components/shell/ContextBadge';
import { householdStatusLabel } from '@/lib/household/presentation';
import { Button } from '@/components/ui/button';

export function HouseholdHeader({
  name,
  status,
  writable = false,
}: {
  name: string;
  status: string;
  writable?: boolean;
}) {
  return (
    <header className="flex w-full min-w-0 flex-col items-start gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="hidden min-w-0 lg:block">
        <ContextBadge household />
        <h1 className="heading mt-2 text-3xl font-bold tracking-tight break-words">{name}</h1>
        <p className="text-text-muted mt-1">{householdStatusLabel(status)} · MXN</p>
      </div>
      {writable && (
        <div className="grid w-full gap-2 sm:flex sm:w-auto">
          <Button asChild size="default">
            <Link href="/dashboard/household/expenses/new">
              Registrar gasto
            </Link>
          </Button>
          <Button asChild variant="outline" size="default">
            <Link href="/dashboard/household/accounts/new">
              Crear fondo común
            </Link>
          </Button>
        </div>
      )}
    </header>
  );
}
