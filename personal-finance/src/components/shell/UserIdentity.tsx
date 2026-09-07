'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, UserRound } from 'lucide-react';
import { useSupabase } from '@/components/providers/supabase-provider';
import { LogoutButton } from '@/components/ui/LogoutButton';
import { ThemeControl } from '@/components/theme/ThemeControl';

type Identity = { name: string; email: string; initials: string };

function initialsFor(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return (
    parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : value.slice(0, 2)
  ).toUpperCase();
}

export function UserIdentity() {
  const { supabase } = useSupabase();
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user || !active) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', user.id)
        .maybeSingle();
      if (!active) return;
      const email = user.email ?? '';
      const metadataName =
        typeof user.user_metadata?.display_name === 'string' ? user.user_metadata.display_name : '';
      const name =
        profile?.display_name?.trim() || metadataName.trim() || email.split('@')[0] || 'Tu cuenta';
      setIdentity({ name, email, initials: initialsFor(name) || 'TU' });
    });
    return () => {
      active = false;
    };
  }, [supabase]);

  useEffect(() => {
    const openMenu = () => setOpen(true);
    const closeOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('open-user-menu', openMenu);
    document.addEventListener('mousedown', closeOutside);
    return () => {
      window.removeEventListener('open-user-menu', openMenu);
      document.removeEventListener('mousedown', closeOutside);
    };
  }, []);

  const label = identity?.name ?? 'Tu cuenta';
  return (
    <div ref={containerRef} id="user-account" className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 max-w-full items-center gap-2 rounded-xl border bg-surface p-1.5 pr-2 text-left hover:bg-surface-subtle"
      >
        <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary-soft text-sm font-bold text-primary">
          {identity?.initials ?? <UserRound aria-hidden="true" className="size-5" />}
        </span>
        <span className="hidden min-w-0 sm:block">
          <span className="block max-w-40 truncate text-sm font-semibold">{label}</span>
          {identity?.email && (
            <span className="block max-w-40 truncate text-xs text-text-muted">
              {identity.email}
            </span>
          )}
        </span>
        <ChevronDown aria-hidden="true" className="hidden size-4 sm:block" />
        <span className="sr-only">Abrir menú de cuenta de {label}</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Cuenta de usuario"
          className="surface-enter absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border bg-surface-raised p-4 shadow-lg"
        >
          <p className="text-xs font-medium text-text-subtle">Sesión iniciada como</p>
          <p className="mt-1 break-words font-semibold">{label}</p>
          {identity?.email && (
            <p className="break-all text-sm text-text-muted">
              {identity.email}
            </p>
          )}
          <div id="appearance" className="my-4 border-y py-4"><ThemeControl /></div>
          <LogoutButton />
        </div>
      )}
    </div>
  );
}
