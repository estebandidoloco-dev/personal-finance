'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  FileUp,
  FolderTree,
  History,
  House,
  Landmark,
  MoreHorizontal,
  Palette,
  ReceiptText,
  Settings,
  Tags,
  UserRound,
  UsersRound,
  Wallet,
  WalletCards,
  X,
} from 'lucide-react';

type NavItem = { href: string; label: string; icon: typeof House };

const personalPrimary: NavItem[] = [
  { href: '/dashboard', label: 'Resumen', icon: House },
  { href: '/dashboard/transactions', label: 'Movimientos', icon: ReceiptText },
  { href: '/dashboard/accounts', label: 'Cuentas', icon: WalletCards },
];
const personalSecondary: NavItem[] = [
  { href: '/dashboard/import', label: 'Importar CSV', icon: FileUp },
  { href: '/dashboard/categories', label: 'Categorías', icon: FolderTree },
  { href: '/dashboard/tags', label: 'Etiquetas', icon: Tags },
];
const householdPrimary: NavItem[] = [
  { href: '/dashboard/household', label: 'Resumen', icon: House },
  { href: '/dashboard/household/expenses', label: 'Gastos', icon: ReceiptText },
  { href: '/dashboard/household/accounts', label: 'Cuentas', icon: Landmark },
];
const householdSecondary: NavItem[] = [
  { href: '/dashboard/household/history', label: 'Historial', icon: History },
  { href: '/dashboard/household/archive', label: 'Espacios anteriores', icon: Archive },
  { href: '/dashboard/household/settings', label: 'Configuración', icon: Settings },
];

function isActive(pathname: string, href: string) {
  if (href === '/dashboard' || href === '/dashboard/household') return pathname === href;
  return pathname.startsWith(href);
}

export function MainNavigation() {
  const pathname = usePathname();
  const isHousehold = pathname.startsWith('/dashboard/household');
  const [householdName, setHouseholdName] = useState('Tu espacio');
  const [moreOpen, setMoreOpen] = useState(false);
  const [spaceOpen, setSpaceOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const spaceCloseRef = useRef<HTMLButtonElement>(null);
  const primary = isHousehold ? householdPrimary : personalPrimary;
  const secondary = isHousehold ? householdSecondary : personalSecondary;
  const contextName = isHousehold ? householdName : 'Mis finanzas';

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/household', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((value: unknown) => {
        if (value && typeof value === 'object' && 'name' in value && typeof value.name === 'string')
          setHouseholdName(value.name);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!moreOpen) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [moreOpen]);

  useEffect(() => {
    if (!spaceOpen) return;
    spaceCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSpaceOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [spaceOpen]);

  const openUserMenu = () => {
    setMoreOpen(false);
    window.dispatchEvent(new Event('open-user-menu'));
  };
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={spaceOpen}
        onClick={() => setSpaceOpen(true)}
        className="bg-surface hover:bg-surface-subtle mb-5 flex min-h-14 w-full min-w-0 items-center gap-3 rounded-2xl border px-3 py-2 text-left lg:hidden"
      >
        <span className="bg-primary-soft text-primary grid size-10 shrink-0 place-items-center rounded-xl">
          {isHousehold ? (
            <UsersRound aria-hidden="true" className="size-5" />
          ) : (
            <Wallet aria-hidden="true" className="size-5" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold break-words">{contextName}</span>
          <span className="text-text-muted block text-xs">
            {isHousehold ? 'En pareja' : 'Personal'}
          </span>
        </span>
        <ChevronDown aria-hidden="true" className="text-text-muted size-5 shrink-0" />
        <span className="sr-only">Cambiar de espacio</span>
      </button>

      <div className="hidden min-w-0 space-y-5 lg:block">
        <section aria-labelledby="space-label">
          <p
            id="space-label"
            className="text-text-muted mb-2 text-xs font-semibold tracking-wide uppercase"
          >
            Espacio actual
          </p>
          <div className="bg-surface space-y-2 rounded-2xl border p-2">
            <Link
              href="/dashboard"
              className={`flex min-h-11 items-center gap-3 rounded-xl border px-3 py-2 text-sm ${!isHousehold ? 'border-primary bg-primary-soft text-primary font-semibold' : 'text-text-muted hover:bg-surface-subtle border-transparent'}`}
            >
              <Wallet aria-hidden="true" className="size-4" />
              <span className="min-w-0">
                <span className="block text-xs opacity-70">Personal</span>
                <span className="block truncate">Mis finanzas</span>
              </span>
            </Link>
            <Link
              href="/dashboard/household"
              className={`flex min-h-11 items-center gap-3 rounded-xl border px-3 py-2 text-sm ${isHousehold ? 'border-primary bg-primary-soft text-primary font-semibold' : 'text-text-muted hover:bg-surface-subtle border-transparent'}`}
            >
              <UsersRound aria-hidden="true" className="size-4" />
              <span className="min-w-0">
                <span className="block text-xs opacity-70">En pareja</span>
                <span className="block truncate">{householdName}</span>
              </span>
            </Link>
          </div>
        </section>
        <nav
          aria-label={isHousehold ? 'Navegación en pareja' : 'Navegación personal'}
          className="space-y-1"
        >
          {[...primary, ...secondary].map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-11 items-center gap-3 rounded-xl border-l-2 px-3 py-2.5 text-sm font-medium ${active ? 'border-primary bg-primary-soft text-text' : 'text-text-muted hover:bg-surface-subtle hover:text-text border-transparent'}`}
              >
                <Icon aria-hidden="true" className="size-5 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>
      </div>

      <nav
        aria-label={
          isHousehold ? 'Navegación principal en pareja' : 'Navegación principal personal'
        }
        className="bg-surface/95 fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t px-2 pt-2 backdrop-blur lg:hidden"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.5rem)' }}
      >
        {primary.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-medium ${active ? 'bg-primary-soft text-primary' : 'text-text-muted'}`}
            >
              <Icon aria-hidden="true" className="size-5" />
              <span className="truncate">{label}</span>
              {active && <span className="sr-only">, página actual</span>}
            </Link>
          );
        })}
        <button
          type="button"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
          className={`flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-medium ${moreOpen || secondary.some((item) => isActive(pathname, item.href)) ? 'bg-primary-soft text-primary' : 'text-text-muted'}`}
        >
          <MoreHorizontal aria-hidden="true" className="size-5" />
          <span>Más</span>
        </button>
      </nav>

      {moreOpen && (
        <div
          className="bg-text/55 fixed inset-0 z-50 lg:hidden"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setMoreOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="more-navigation-title"
            className="surface-enter bg-surface-raised absolute inset-x-0 bottom-0 max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-t-3xl border-t p-4 pb-[max(env(safe-area-inset-bottom),1rem)] shadow-xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 id="more-navigation-title" className="text-lg font-bold">
                Más opciones
              </h2>
              <button
                ref={closeRef}
                type="button"
                aria-label="Cerrar más opciones"
                onClick={() => setMoreOpen(false)}
                className="grid size-11 place-items-center rounded-xl border"
              >
                <X aria-hidden="true" className="size-5" />
              </button>
            </div>
            <div className="space-y-2">
              {secondary.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMoreOpen(false)}
                  className="flex min-h-12 items-center gap-3 rounded-xl border px-4"
                >
                  <Icon aria-hidden="true" className="size-5" />
                  <span className="flex-1">{label}</span>
                  <ChevronRight aria-hidden="true" className="size-4" />
                </Link>
              ))}
              <button
                type="button"
                onClick={openUserMenu}
                className="flex min-h-12 w-full items-center gap-3 rounded-xl border px-4 text-left"
              >
                <Palette aria-hidden="true" className="size-5" />
                <span className="flex-1">Apariencia</span>
                <ChevronRight aria-hidden="true" className="size-4" />
              </button>
              <button
                type="button"
                onClick={openUserMenu}
                className="flex min-h-12 w-full items-center gap-3 rounded-xl border px-4 text-left"
              >
                <UserRound aria-hidden="true" className="size-5" />
                <span className="flex-1">Cuenta</span>
                <ChevronRight aria-hidden="true" className="size-4" />
              </button>
            </div>
          </section>
        </div>
      )}

      {spaceOpen && (
        <div
          className="bg-text/55 fixed inset-0 z-50 lg:hidden"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSpaceOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="space-switch-title"
            className="surface-enter bg-surface-raised absolute inset-x-0 bottom-0 max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-t-3xl border-t p-4 pb-[max(env(safe-area-inset-bottom),1rem)] shadow-xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 id="space-switch-title" className="text-lg font-bold">
                Cambiar de espacio
              </h2>
              <button
                ref={spaceCloseRef}
                type="button"
                aria-label="Cerrar selector de espacio"
                onClick={() => setSpaceOpen(false)}
                className="grid size-11 place-items-center rounded-xl border"
              >
                <X aria-hidden="true" className="size-5" />
              </button>
            </div>
            <nav aria-label="Espacios disponibles" className="space-y-2">
              <Link
                href="/dashboard"
                aria-current={!isHousehold ? 'page' : undefined}
                onClick={() => setSpaceOpen(false)}
                className={`flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2 ${!isHousehold ? 'border-primary bg-primary-soft' : 'bg-surface hover:bg-surface-subtle'}`}
              >
                <Wallet aria-hidden="true" className="size-5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">Mis finanzas</span>
                  <span className="text-text-muted block text-xs">Personal</span>
                </span>
                {!isHousehold && <Check aria-hidden="true" className="text-primary size-5" />}
                {!isHousehold && <span className="sr-only">Espacio actual</span>}
              </Link>
              <Link
                href="/dashboard/household"
                aria-current={isHousehold ? 'page' : undefined}
                onClick={() => setSpaceOpen(false)}
                className={`flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2 ${isHousehold ? 'border-primary bg-primary-soft' : 'bg-surface hover:bg-surface-subtle'}`}
              >
                <UsersRound aria-hidden="true" className="size-5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold break-words">{householdName}</span>
                  <span className="text-text-muted block text-xs">En pareja</span>
                </span>
                {isHousehold && <Check aria-hidden="true" className="text-primary size-5" />}
                {isHousehold && <span className="sr-only">Espacio actual</span>}
              </Link>
            </nav>
          </section>
        </div>
      )}
    </>
  );
}
