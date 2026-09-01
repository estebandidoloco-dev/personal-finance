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
    <div className="text-right">
      <button
        type="button"
        onClick={handleLogout}
        disabled={loading}
        className="text-sm text-gray-600 hover:text-gray-900 hover:underline disabled:opacity-50"
      >
        {loading ? 'Cerrando sesión...' : 'Cerrar sesión'}
      </button>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
