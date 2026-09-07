'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSupabase } from '@/components/providers/supabase-provider';

export function LogoutButton() {
  const { supabase } = useSupabase();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogout = async () => {
    setLoading(true);
    setError('');

    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        setError('No se pudo cerrar la sesión. Inténtalo de nuevo.');
        return;
      }

      router.replace('/login');
      router.refresh();
    } catch {
      setError('No se pudo conectar con el servicio de autenticación.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={handleLogout}
        disabled={loading}
        className="min-h-11 w-full rounded-xl border border-danger bg-danger-soft px-4 text-left text-sm font-medium text-danger hover:opacity-80 disabled:opacity-50"
      >
        {loading ? 'Cerrando sesión...' : 'Cerrar sesión'}
      </button>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
