'use client';

import { createContext, useContext } from 'react';
import { z } from 'zod';
import { useSupabase } from '@/components/providers/supabase-provider';
import { archivedHouseholdSchema, householdSchema, type ArchivedHousehold, type Household } from '@/lib/contracts/household';
import { useApiResource } from '@/hooks/use-api-resource';
import { AsyncState } from '@/components/shell/AsyncState';
import { ErrorPanel } from '@/components/shell/ErrorPanel';

type Value = { current: Household | null; archives: ArchivedHousehold[]; userId: string; refresh: () => void };
const HouseholdContext = createContext<Value | null>(null);

export function HouseholdProvider({ children }: { children: React.ReactNode }) {
  const { supabase } = useSupabase();
  const resource = useApiResource(async (signal) => {
    const [{ data: { user } }, currentResponse, archiveResponse] = await Promise.all([supabase.auth.getUser(), fetch('/api/household', { signal }), fetch('/api/household/archive', { signal })]);
    if (!user) throw new Error('Tu sesión no está disponible.');
    const currentPayload: unknown = await currentResponse.json().catch(() => null); const archivePayload: unknown = await archiveResponse.json().catch(() => null);
    if (!currentResponse.ok || !archiveResponse.ok) throw new Error('No se pudo cargar tu espacio En pareja.');
    const current = householdSchema.nullable().parse(currentPayload);
    const archives = z.object({ households: archivedHouseholdSchema.array() }).parse(archivePayload).households;
    return { current, archives, userId: user.id };
  }, 'household-context');
  if (resource.status === 'loading') return <AsyncState label="Cargando espacio En pareja…" />;
  if (resource.status === 'error') return <ErrorPanel message={resource.error} onRetry={resource.retry} />;
  return <HouseholdContext.Provider value={{ ...resource.data, refresh: resource.retry }}>{children}</HouseholdContext.Provider>;
}

export function useHousehold() {
  const value = useContext(HouseholdContext); if (!value) throw new Error('useHousehold requiere HouseholdProvider'); return value;
}
