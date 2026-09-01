'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface DeleteAccountButtonProps {
  accountId: string;
}

export function DeleteAccountButton({ accountId }: DeleteAccountButtonProps) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm('¿Eliminar esta cuenta?')) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/accounts/${accountId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Error al eliminar');
      router.refresh();
    } catch (err: unknown) {
      alert('Error: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={deleting}
      className="text-sm text-red-600 hover:underline disabled:opacity-50"
    >
      {deleting ? 'Eliminando...' : 'Eliminar'}
    </button>
  );
}
