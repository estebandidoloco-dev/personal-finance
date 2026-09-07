'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { personalAccountResponseSchema } from '@/lib/validation/financial';
import { useApiResource } from '@/hooks/use-api-resource';
import { PersonalAccountForm } from '@/components/accounts/PersonalAccountForm';
import { AsyncState } from '@/components/shell/AsyncState';
import { ErrorPanel } from '@/components/shell/ErrorPanel';
import { ContextBadge } from '@/components/shell/ContextBadge';
import { ArrowLeft } from 'lucide-react';

export default function EditAccountPage() {
  const id = useParams<{ id: string }>().id;
  const resource = useApiResource(async (signal) => { const response = await fetch(`/api/accounts/${id}`, { signal }); const payload: unknown = await response.json().catch(() => null); if (!response.ok) throw new Error('No se pudo cargar la cuenta.'); return personalAccountResponseSchema.parse(payload); }, id);
  return <main className="mx-auto w-full min-w-0 max-w-2xl space-y-5"><header><ContextBadge /><h1 className="mt-2 text-3xl font-bold">Editar cuenta personal</h1></header>{resource.status === 'loading' && <AsyncState />}{resource.status === 'error' && <ErrorPanel message={resource.error} onRetry={resource.retry} />}{(resource.status === 'success' || resource.status === 'empty') && <PersonalAccountForm account={resource.data} />}<Link href="/dashboard/accounts" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary hover:underline"><ArrowLeft aria-hidden="true" className="size-4" />Volver a cuentas</Link></main>;
}
