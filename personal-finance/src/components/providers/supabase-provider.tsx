'use client';

import { createBrowserClient } from '@supabase/ssr';
import { createContext, useContext, useState, ReactNode } from 'react';
import type { Database } from '@/lib/database.types';

type SupabaseContextType = {
  supabase: ReturnType<typeof createBrowserClient<Database>>;
};

const SupabaseContext = createContext<SupabaseContextType | null>(null);

export function SupabaseProvider({ children }: { children: ReactNode }) {
  const [supabase] = useState(() =>
    createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  );
  return <SupabaseContext.Provider value={{ supabase }}>{children}</SupabaseContext.Provider>;
}

export function useSupabase() {
  const context = useContext(SupabaseContext);
  if (!context) throw new Error('useSupabase debe usarse dentro de SupabaseProvider');
  return context;
}
