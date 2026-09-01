'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface DeleteAccountButtonProps {
  accountId: string;
}

export function DeleteAccountButton({ accountId }: DeleteAccountButtonProps) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const handleDelete = async () => {
    if (!confirm('¿Eliminar esta cuenta?')) return;

    setDeleting(true);
    setError('');
    try {
      const res = await fetch(`/api/accounts/${accountId}`, { method: 'DELETE' });
      if (!res.ok) {
        const result = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error || 'No se pudo eliminar la cuenta');
      }
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar la cuenta');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        className="text-sm text-red-600 hover:underline disabled:opacity-50"
      >
        {deleting ? 'Eliminando...' : 'Eliminar'}
      </button>
      {error && <p className="mt-1 max-w-xs text-sm text-red-600">{error}</p>}
    </div>
  );
}
