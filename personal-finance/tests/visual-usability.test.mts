import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
// @ts-expect-error Node type stripping requires source extensions.
// prettier-ignore
import { getExpenseCategoryLabel, transactionStatusLabel } from '../src/lib/household/presentation.ts';
// @ts-expect-error Node type stripping requires source extensions.
// prettier-ignore
import { CATEGORY_ICON_OPTIONS, resolveCategoryIconKey } from '../src/lib/ui/category-icon.ts';
// @ts-expect-error Node type stripping requires source extensions.
// prettier-ignore
import { parseThemePreference, resolveTheme, THEME_BOOTSTRAP_SCRIPT, THEME_STORAGE_KEY } from '../src/lib/theme.ts';

const source = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('category icons use a static lucide mapper and graphical fallback', async () => {
  const iconSource = await source('../src/components/ui/CategoryIcon.tsx');
  for (const mapping of [
    'home: <House',
    'utensils: <Utensils',
    'car: <Car',
    "'heart-pulse': <HeartPulse",
    "'gamepad-2': <Gamepad2",
    "'shopping-bag': <ShoppingBag",
    "'credit-card': <CreditCard",
  ])
    assert.match(iconSource, new RegExp(mapping.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(iconSource, /CircleEllipsis/);
  assert.match(iconSource, /aria-hidden="true"/);
  assert.match(iconSource, /size-10/);
  assert.doesNotMatch(iconSource, /import\(/);
  assert.equal(resolveCategoryIconKey('HOME'), 'home');
  assert.equal(resolveCategoryIconKey('shopping-bag'), 'shopping-bag');
  assert.equal(resolveCategoryIconKey('arbitrary-component-name'), 'circle-ellipsis');
  assert.equal(resolveCategoryIconKey(null), 'circle-ellipsis');
});

test('transaction statuses are translated for visible UI', () => {
  assert.equal(transactionStatusLabel('posted'), 'Confirmado');
  assert.equal(transactionStatusLabel('pending'), 'Pendiente');
  assert.equal(transactionStatusLabel('cancelled'), 'Cancelado');
  assert.equal(transactionStatusLabel('duplicate'), 'Duplicado');
});

test('mobile navigation has four context-specific destinations and an accessible sheet', async () => {
  const navigation = await source('../src/components/shell/MainNavigation.tsx');
  assert.match(navigation, /householdPrimary/);
  assert.match(navigation, /label: 'Resumen'/);
  assert.match(navigation, /label: 'Movimientos'/);
  assert.match(navigation, /label: 'Gastos'/);
  assert.match(navigation, /label: 'Cuentas'/);
  assert.match(navigation, />Más</);
  assert.match(navigation, /grid-cols-4/);
  assert.match(navigation, /safe-area-inset-bottom/);
  assert.match(navigation, /aria-current/);
  assert.match(navigation, /aria-modal="true"/);
  assert.match(navigation, /min-h-12/);
});

test('390px shell containment does not hide global horizontal overflow', async () => {
  const [shell, globalStyles] = await Promise.all([
    source('../src/components/shell/DashboardShell.tsx'),
    source('../src/app/globals.css'),
  ]);
  assert.match(shell, /w-full min-w-0/);
  assert.match(shell, /lg:grid-cols-\[14rem_minmax\(0,1fr\)\]/);
  assert.doesNotMatch(globalStyles, /(?:html|body)[^{]*\{[^}]*overflow-x:\s*hidden[\s\S]*\}/);
});

test('invitation acceptance refreshes shared state and leaves persistent feedback', async () => {
  const [invite, dashboard] = await Promise.all([
    source('../src/app/dashboard/household/invite/page.tsx'),
    source('../src/app/dashboard/household/page.tsx'),
  ]);
  assert.match(invite, /const \{ refresh \} = useHousehold\(\)/);
  assert.match(invite, /refresh\(\)/);
  assert.match(invite, /household_invitation_accepted/);
  assert.match(dashboard, /Invitación aceptada/);
  assert.match(dashboard, /Listo, ya comparten/);
  assert.match(dashboard, /Ir al resumen/);
  assert.match(dashboard, /members\.map/);
});

test('key visual copy avoids implementation terminology', async () => {
  const files = await Promise.all([
    source('../src/app/dashboard/page.tsx'),
    source('../src/app/dashboard/import/page.tsx'),
    source('../src/components/accounts/PersonalAccountForm.tsx'),
    source('../src/app/dashboard/household/setup/page.tsx'),
    source('../src/components/household/HouseholdAccountsView.tsx'),
  ]);
  const visibleSources = files.join('\n');
  assert.match(visibleSources, /Registrar movimiento/);
  assert.match(visibleSources, /Crear espacio/);
  assert.match(visibleSources, /fondos comunes/i);
  assert.doesNotMatch(
    visibleSources,
    /ledger atómico|saldo canónico|Crear Household|Fondos Household/
  );
});

test('theme preferences parse and resolve system, light and dark deterministically', () => {
  assert.equal(parseThemePreference('system'), 'system');
  assert.equal(parseThemePreference('light'), 'light');
  assert.equal(parseThemePreference('dark'), 'dark');
  assert.equal(parseThemePreference('invalid'), 'system');
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
});

test('theme control persists the stable visual preference and bootstrap prevents flash', async () => {
  const [control, layout] = await Promise.all([
    source('../src/components/theme/ThemeControl.tsx'),
    source('../src/app/layout.tsx'),
  ]);
  assert.equal(THEME_STORAGE_KEY, 'personal-finance-theme');
  assert.match(control, /localStorage\.setItem\(THEME_STORAGE_KEY, preference\)/);
  assert.match(control, /document\.documentElement\.dataset\.theme = resolved/);
  assert.match(control, /prefers-color-scheme: dark/);
  assert.match(control, /Sistema/);
  assert.match(control, /Claro/);
  assert.match(control, /Oscuro/);
  assert.match(THEME_BOOTSTRAP_SCRIPT, /localStorage\.getItem/);
  assert.match(layout, /THEME_BOOTSTRAP_SCRIPT/);
  assert.match(layout, /suppressHydrationWarning/);
  assert.doesNotMatch(layout, /next\/font\/google/);
});

test('personal accounts expose controlled deletion without backend detail leakage', async () => {
  const accounts = await source('../src/app/dashboard/accounts/page.tsx');
  assert.match(accounts, /method: 'DELETE'/);
  assert.match(accounts, /¿Eliminar esta cuenta\?/);
  assert.match(accounts, /No podemos eliminar esta cuenta mientras tenga movimientos asociados/);
  assert.match(accounts, /Cuenta eliminada/);
  assert.match(accounts, /<ConfirmDialog/);
  assert.doesNotMatch(accounts, /window\.confirm|23503|foreign key|RLS|SQL/i);
});

test('semantic palette defines both themes and context badges avoid legacy colors', async () => {
  const [styles, badge] = await Promise.all([
    source('../src/app/globals.css'),
    source('../src/components/shell/ContextBadge.tsx'),
  ]);
  for (const token of [
    '--background: #f6f7f5',
    '--surface: #ffffff',
    '--primary: #5f7668',
    '--focus-ring: #718c7b',
    "root[data-theme='dark']",
    '--background: #1a1d1b',
    '--surface: #232724',
    '--primary: #8fa897',
    '--focus-ring: #a2b7a9',
  ]) {
    assert.match(styles, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(badge, /Wallet/);
  assert.match(badge, /UsersRound/);
  assert.match(badge, /bg-primary-soft text-primary/);
  assert.match(badge, /bg-info-soft text-info/);
  assert.doesNotMatch(badge, /blue-|violet-|purple-|indigo-/);
});

test('mobile space switch navigates both ways and marks the current context', async () => {
  const navigation = await source('../src/components/shell/MainNavigation.tsx');
  assert.match(navigation, /Cambiar de espacio/);
  assert.match(navigation, /href="\/dashboard"/);
  assert.match(navigation, /href="\/dashboard\/household"/);
  assert.match(navigation, /aria-current=\{!isHousehold \? 'page'/);
  assert.match(navigation, /aria-current=\{isHousehold \? 'page'/);
  assert.match(navigation, /Wallet/);
  assert.match(navigation, /UsersRound/);
  assert.match(navigation, /safe-area-inset-bottom/);
  assert.match(navigation, /min-h-14/);
});

test('household page context is hidden when the mobile shell already identifies it', async () => {
  const header = await source('../src/components/household/HouseholdHeader.tsx');
  assert.match(header, /hidden min-w-0 lg:block/);
  assert.match(header, /ContextBadge household/);
});

test('category actions use a mobile sheet before a controlled confirmation', async () => {
  const [tree, page] = await Promise.all([
    source('../src/components/ui/CategoryTree.tsx'),
    source('../src/app/dashboard/categories/page.tsx'),
  ]);
  assert.match(tree, /sm:hidden/);
  assert.match(tree, /safe-area-inset-bottom/);
  assert.match(tree, /Eliminar categoría/);
  assert.match(tree, /Cancelar/);
  assert.match(page, /setDeleteCandidate\(category\)/);
  assert.match(page, /<ConfirmDialog/);
  assert.match(page, /Esta categoría dejará de estar disponible para nuevos movimientos/);
  assert.doesNotMatch(page, /window\.confirm/);
});

test('category icon picker exposes a human-labelled allowlist and keeps legacy fallback', async () => {
  const form = await source('../src/components/ui/CategoryForm.tsx');
  assert.ok(CATEGORY_ICON_OPTIONS.length >= 20 && CATEGORY_ICON_OPTIONS.length <= 30);
  assert.equal(resolveCategoryIconKey('plane'), 'plane');
  assert.equal(resolveCategoryIconKey('gamepad-2'), 'gamepad-2');
  assert.equal(resolveCategoryIconKey('legacy-emoji-value'), 'circle-ellipsis');
  assert.match(form, /Elegir icono/);
  assert.match(form, /Selecciona un icono/);
  assert.match(form, /aria-pressed=\{selected\}/);
  assert.match(form, /grid-cols-4/);
  assert.doesNotMatch(form, /placeholder="(?:home|gamepad-2|utensils)"/);
});

test('common fund cards use UsersRound metadata without the former large badge', async () => {
  const [accounts, dashboard] = await Promise.all([
    source('../src/components/household/HouseholdAccountsView.tsx'),
    source('../src/app/dashboard/household/page.tsx'),
  ]);
  assert.match(accounts, /UsersRound/);
  assert.match(accounts, /Fondo común/);
  assert.match(dashboard, /UsersRound/);
  assert.doesNotMatch(accounts, />\s*Fondos comunes\s*</);
  assert.doesNotMatch(dashboard, />\s*Fondos comunes\s*</);
});

test('household expense category presentation uses the approved projection only', async () => {
  const [activity, detail, dashboard] = await Promise.all([
    source('../src/components/household/HouseholdActivityList.tsx'),
    source('../src/app/dashboard/household/expenses/[id]/page.tsx'),
    source('../src/app/dashboard/household/page.tsx'),
  ]);
  assert.equal(getExpenseCategoryLabel({ category: { name: 'Vivienda' } }), 'Vivienda');
  assert.equal(getExpenseCategoryLabel({ category: null }), 'Sin categoría');
  assert.match(activity, /getExpenseCategoryLabel\(item\)/);
  assert.match(detail, /getExpenseCategoryLabel\(detail\)/);
  assert.doesNotMatch(`${activity}\n${detail}\n${dashboard}`, /Incluida por la app/);
  assert.doesNotMatch(dashboard, /api\/categories|categoryNames/);
});

test('previous spaces copy and archived route composition remain read-only', async () => {
  const [navigation, list, detail, banner] = await Promise.all([
    source('../src/components/shell/MainNavigation.tsx'),
    source('../src/app/dashboard/household/archive/page.tsx'),
    source('../src/app/dashboard/household/archive/[householdId]/page.tsx'),
    source('../src/components/household/ReadOnlyBanner.tsx'),
  ]);
  assert.match(navigation, /Espacios anteriores/);
  assert.match(list, /Espacios anteriores/);
  assert.match(list, /Consulta la información de espacios En pareja que ya cerraron/);
  assert.match(list, /Ver historial/);
  assert.match(list, /archive\/\$\{item\.id\}/);
  assert.match(detail, /useParams<\{ householdId: string \}>\(\)\.householdId/);
  assert.match(detail, /household_id=\$\{query\}/);
  assert.match(detail, /ArchiveRequestError/);
  assert.match(detail, /readOnly/);
  assert.doesNotMatch(detail, /current(?:Household)?\.id|writable/);
  assert.match(banner, /Este espacio está cerrado y es de solo lectura/);
  assert.doesNotMatch(`${navigation}\n${list}`, /Espacios cerrados|Abrir historial/);
});
