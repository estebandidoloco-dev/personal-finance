'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, UsersRound } from 'lucide-react';
import { householdAccountSchema, memberSchema } from '@/lib/contracts/household';
import { householdBalanceResponseSchema } from '@/lib/validation/household';
import { useHousehold } from '@/components/household/HouseholdContext';
import { HouseholdHeader } from '@/components/household/HouseholdHeader';
import { HouseholdActivityList } from '@/components/household/HouseholdActivityList';
import { useApiResource } from '@/hooks/use-api-resource';
import { AsyncState } from '@/components/shell/AsyncState';
import { ErrorPanel } from '@/components/shell/ErrorPanel';
import { EmptyState } from '@/components/shell/EmptyState';
import { ContextBadge } from '@/components/shell/ContextBadge';
import { MoneyAmount } from '@/components/dashboard/MoneyAmount';
import { memberName } from '@/lib/household/presentation';

const ACCEPTED_FLASH_KEY = 'household_invitation_accepted';

export default function HouseholdDashboardPage() {
  const { current, archives, userId } = useHousehold();
  if (!current)
    return (
      <main className="w-full min-w-0 space-y-6">
        <header>
          <ContextBadge household />
          <h1 className="mt-2 text-3xl font-bold break-words">Finanzas en pareja</h1>
          <p className="text-text-muted mt-2">
            Tus cuentas personales permanecen privadas y separadas.
          </p>
        </header>
        {archives.length ? (
          <EmptyState
            title="No tienes un espacio vigente"
            description="Puedes consultar tus espacios anteriores o crear uno nuevo."
            action={
              <div className="flex flex-col justify-center gap-2 sm:flex-row">
                <Link
                  href="/dashboard/household/archive"
                  className="bg-surface min-h-11 rounded-xl border px-4 py-2.5"
                >
                  Ver espacios anteriores
                </Link>
                <Link
                  href="/dashboard/household/setup"
                  className="bg-primary text-on-primary min-h-11 rounded-xl px-4 py-2.5 font-semibold"
                >
                  Crear nuevo espacio
                </Link>
              </div>
            }
          />
        ) : (
          <EmptyState
            title="Crea tu espacio En pareja"
            description="Invita a una persona para gestionar gastos y fondos comunes sin mezclar cuentas personales."
            action={
              <Link
                href="/dashboard/household/setup"
                className="bg-primary text-on-primary inline-flex min-h-11 items-center rounded-xl px-4 font-semibold"
              >
                Comenzar
              </Link>
            }
          />
        )}
      </main>
    );
  if (current.status === 'forming')
    return (
      <main className="w-full min-w-0 space-y-5">
        <HouseholdHeader name={current.name} status={current.status} />
        <EmptyState
          title="Falta aceptar la invitación"
          description="El resumen financiero se habilitará cuando haya exactamente dos miembros."
          action={
            <Link
              href="/dashboard/household/setup"
              className="bg-primary text-on-primary inline-flex min-h-11 items-center rounded-xl px-4 font-semibold"
            >
              Continuar configuración
            </Link>
          }
        />
      </main>
    );
  return <ActiveDashboard householdId={current.id} name={current.name} userId={userId} />;
}

function ActiveDashboard({
  householdId,
  name,
  userId,
}: {
  householdId: string;
  name: string;
  userId: string;
}) {
  const [accepted, setAccepted] = useState(false);
  useEffect(() => {
    if (sessionStorage.getItem(ACCEPTED_FLASH_KEY) === '1') {
      sessionStorage.removeItem(ACCEPTED_FLASH_KEY);
      // This state reflects navigation feedback stored by the invitation acceptance flow.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAccepted(true);
    }
  }, []);
  const resource = useApiResource(async (signal) => {
    const query = encodeURIComponent(householdId);
    const responses = await Promise.all([
      fetch(`/api/household/members?household_id=${query}`, { signal }),
      fetch(`/api/household/accounts?household_id=${query}`, { signal }),
      fetch(`/api/household/balance?household_id=${query}`, { signal }),
    ]);
    const payloads: unknown[] = await Promise.all(
      responses.map((response) => response.json().catch(() => null))
    );
    if (responses.some((response) => !response.ok))
      throw new Error('No se pudo cargar el resumen del espacio.');
    return {
      members: memberSchema.array().length(2).parse(payloads[0]),
      accounts: householdAccountSchema.array().parse(payloads[1]),
      balance: householdBalanceResponseSchema.parse(payloads[2]),
    };
  }, householdId);
  if (resource.status === 'loading') return <AsyncState label="Cargando resumen del espacio…" />;
  if (resource.status === 'error')
    return <ErrorPanel message={resource.error} onRetry={resource.retry} />;
  const { members, accounts, balance } = resource.data;
  const other = members.find((member) => member.user_id !== userId);
  const otherName = memberName(other);
  const even = !balance.owed_by_user_id || balance.amount === '0.00';
  const balanceText = even
    ? 'Están a mano'
    : balance.owed_by_user_id === userId
      ? `Tú debes a ${otherName}`
      : `${otherName} te debe`;
  const explanation = even
    ? 'Nadie tiene dinero pendiente por devolver.'
    : balance.owed_by_user_id === userId
      ? `Este importe proviene de gastos que ${otherName} pagó con dinero personal por ambos.`
      : 'Este importe proviene de gastos que pagaste con dinero personal por ambos.';
  return (
    <main id="household-summary" className="w-full min-w-0 space-y-7">
      {accepted && (
        <>
          <div
            role="status"
            aria-live="polite"
            className="surface-enter bg-success text-on-primary fixed top-20 right-4 z-40 rounded-xl px-4 py-3 text-sm font-semibold shadow-lg"
          >
            Invitación aceptada
          </div>
          <section className="surface-enter border-success bg-success-soft text-text rounded-2xl border p-5">
            <div className="flex items-start gap-3">
              <CheckCircle2 aria-hidden="true" className="text-success mt-0.5 size-6 shrink-0" />
              <div className="min-w-0">
                <h2 className="text-lg font-bold break-words">Listo, ya comparten «{name}».</h2>
                <p className="mt-2 text-sm">
                  {members.map((member) => memberName(member, userId)).join(' y ')}
                </p>
                <a
                  href="#household-summary"
                  className="text-primary mt-3 inline-flex min-h-11 items-center font-semibold underline"
                >
                  Ir al resumen
                </a>
              </div>
            </div>
          </section>
        </>
      )}
      <p className="text-text-muted text-sm lg:hidden">
        {members.map((member) => memberName(member, userId)).join(' · ')}
      </p>
      <HouseholdHeader name={name} status="active" writable />
      <p className="text-text-muted hidden text-sm lg:block">
        {members.map((member) => memberName(member, userId)).join(' · ')}
      </p>
      <section className="bg-info-soft w-full min-w-0 rounded-2xl border p-5">
        <p className="text-text-muted text-sm font-semibold">Balance entre ustedes</p>
        <h2 className="mt-2 flex items-center gap-2 text-2xl font-bold break-words">
          {even && <CheckCircle2 aria-hidden="true" className="text-success size-6" />}
          {balanceText}
        </h2>
        {!even && (
          <MoneyAmount amount={balance.amount} className="mt-2 inline-block text-xl font-bold" />
        )}
        <p className="mt-3 max-w-2xl text-sm">{explanation}</p>
        <p className="text-text-muted mt-2 max-w-2xl text-xs">
          No es un saldo bancario. Solo refleja gastos personales adelantados.
        </p>
      </section>
      <section className="min-w-0 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold">Cuentas comunes</h2>
          <Link
            href="/dashboard/household/accounts"
            className="text-primary min-h-11 py-2.5 text-sm hover:underline"
          >
            Ver todas
          </Link>
        </div>
        {accounts.length ? (
          <ul className="grid min-w-0 gap-3 sm:grid-cols-2">
            {accounts.map((account) => (
              <li key={account.id} className="bg-surface w-full min-w-0 rounded-2xl border p-4">
                <div className="flex min-w-0 gap-3">
                  <div className="flex min-w-0 gap-3">
                    <span className="bg-surface-subtle text-info flex size-10 shrink-0 items-center justify-center rounded-xl">
                      <UsersRound aria-hidden="true" className="size-5" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-semibold break-words">{account.name}</h3>
                      <p className="text-text-muted text-sm">Fondo común</p>
                    </div>
                  </div>
                </div>
                <MoneyAmount
                  amount={account.balance}
                  className="mt-3 inline-block text-lg font-bold"
                />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No hay cuentas comunes"
            action={
              <Link href="/dashboard/household/accounts/new" className="text-primary">
                Crear fondo común
              </Link>
            }
          />
        )}
      </section>
      <section className="min-w-0 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold">Últimos gastos</h2>
          <Link
            href="/dashboard/household/expenses"
            className="text-primary min-h-11 py-2.5 text-sm hover:underline"
          >
            Ver todos
          </Link>
        </div>
        <HouseholdActivityList
          householdId={householdId}
          endpoint="expenses"
          members={members}
          userId={userId}
          limit={10}
          compact
        />
      </section>
    </main>
  );
}
