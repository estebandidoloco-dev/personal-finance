'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useApiResource } from '@/hooks/use-api-resource';
import { useHousehold } from '@/components/household/HouseholdContext';
import { ReadOnlyBanner } from '@/components/household/ReadOnlyBanner';
import { HouseholdHeader } from '@/components/household/HouseholdHeader';
import { HouseholdAccountsView } from '@/components/household/HouseholdAccountsView';
import { HouseholdActivityList } from '@/components/household/HouseholdActivityList';
import { AsyncState } from '@/components/shell/AsyncState';
import { ErrorPanel } from '@/components/shell/ErrorPanel';
import { MoneyAmount } from '@/components/dashboard/MoneyAmount';
import { archivedBalancePresentation, memberName } from '@/lib/household/presentation';
import { parseArchivedHouseholdResources } from '@/lib/household/archive-resource';
import { readApiError } from '@/lib/api-error';

type ArchiveResource = 'archive-detail' | 'members' | 'balance';

class ArchiveRequestError extends Error {
  constructor(
    readonly resource: ArchiveResource,
    readonly status: number,
    readonly code?: string
  ) {
    super('No se pudo cargar el espacio anterior.');
    this.name = 'ArchiveRequestError';
  }
}

async function readArchiveResponse(response: Response, resource: ArchiveResource) {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const apiError = readApiError(payload, 'No se pudo cargar el espacio anterior.');
    throw new ArchiveRequestError(resource, response.status, apiError.code);
  }
  return payload;
}

export default function ArchivedHouseholdDetailPage() {
  const householdId = useParams<{ householdId: string }>().householdId;
  const { userId } = useHousehold();
  const resource = useApiResource(async (signal) => {
    const query = encodeURIComponent(householdId);
    const [archiveResponse, membersResponse, balanceResponse] = await Promise.all([
      fetch(`/api/household/archive/${query}`, { signal }),
      fetch(`/api/household/members?household_id=${query}`, { signal }),
      fetch(`/api/household/balance?household_id=${query}`, { signal }),
    ]);
    const [archivePayload, membersPayload, balancePayload] = await Promise.all([
      readArchiveResponse(archiveResponse, 'archive-detail'),
      readArchiveResponse(membersResponse, 'members'),
      readArchiveResponse(balanceResponse, 'balance'),
    ]);
    return parseArchivedHouseholdResources({
      archive: archivePayload,
      members: membersPayload,
      balance: balancePayload,
    });
  }, householdId);
  if (resource.status === 'loading') return <AsyncState label="Cargando espacio cerrado…" />;
  if (resource.status === 'error')
    return <ErrorPanel message={resource.error} onRetry={resource.retry} />;
  const { archive, members, balance } = resource.data;
  const otherName =
    members.length === 2 ? memberName(members.find((member) => member.user_id !== userId)) : '';
  const balancePresentation = archivedBalancePresentation(
    members.length,
    balance,
    userId,
    otherName
  );
  return (
    <main className="min-w-0 space-y-7">
      <ReadOnlyBanner />
      <HouseholdHeader name={archive.name} status="closed" />
      <p className="text-text-muted text-sm">
        Miembros: {members.map((member) => memberName(member, userId)).join(' y ')}
      </p>
      <p className="text-text-muted text-sm">
        Cerrado el{' '}
        {new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(
          new Date(archive.closed_at)
        )}
      </p>
      <section className="bg-info-soft min-w-0 rounded-2xl border p-5">
        {balancePresentation.label && (
          <p className="text-text-muted text-sm">{balancePresentation.label}</p>
        )}
        <h2 className="mt-1 text-xl font-bold">{balancePresentation.title}</h2>
        {balancePresentation.amount && (
          <MoneyAmount
            amount={balancePresentation.amount}
            className="mt-2 inline-block text-xl font-bold"
          />
        )}
        <p className="text-text-muted mt-2 text-sm">{balancePresentation.helper}</p>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-bold">Cuentas</h2>
        <HouseholdAccountsView householdId={householdId} readOnly />
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-bold">Gastos</h2>
        <HouseholdActivityList
          householdId={householdId}
          endpoint="expenses"
          members={members}
          userId={userId}
          readOnly
        />
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-bold">Historial</h2>
        <HouseholdActivityList
          householdId={householdId}
          endpoint="history"
          members={members}
          userId={userId}
          readOnly
        />
      </section>
      <Link
        href="/dashboard/household/archive"
        className="text-primary inline-flex min-h-11 items-center hover:underline"
      >
        Volver a espacios anteriores
      </Link>
    </main>
  );
}
