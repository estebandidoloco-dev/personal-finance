'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSupabase } from '@/components/providers/supabase-provider';
import { Button } from '@/components/ui/button';

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
      <Button
        type="button"
        variant="outline"
        onClick={handleLogout}
        disabled={loading}
        className="min-h-11 w-full justify-start border-danger/40 bg-danger-soft text-danger hover:bg-danger-soft/80"
      >
        {loading ? 'Cerrando sesión...' : 'Cerrar sesión'}
      </Button>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
