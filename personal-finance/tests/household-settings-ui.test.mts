import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
// @ts-expect-error Node type stripping requires source extensions.
// prettier-ignore
import { closeHousehold } from '../src/lib/household/close-household.ts';

const source = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');
const householdId = '64100000-0000-4000-8000-000000000001';

test('Household navigation exposes settings on desktop and inside mobile More', async () => {
  const navigation = await source('../src/components/shell/MainNavigation.tsx');

  assert.match(navigation, /Settings/);
  assert.match(navigation, /href: '\/dashboard\/household\/settings'/);
  assert.match(navigation, /label: 'Configuración'/);
  assert.match(navigation, /secondary\.map/);
  assert.match(navigation, /\[\.\.\.primary, \.\.\.secondary\]\.map/);
});

test('settings shows metadata and moves closing behind the shared confirmation dialog', async () => {
  const [settings, setup] = await Promise.all([
    source('../src/app/dashboard/household/settings/page.tsx'),
    source('../src/app/dashboard/household/setup/page.tsx'),
  ]);

  assert.match(settings, /Nombre del espacio/);
  assert.match(settings, /Miembros/);
  assert.match(settings, /Moneda/);
  assert.match(settings, /Administración del espacio/);
  assert.match(settings, /El espacio pasará a «Espacios anteriores»/);
  assert.match(settings, /<ConfirmDialog/);
  assert.match(settings, /title=\{`¿Cerrar \$\{current\.name\}\?`\}/);
  assert.match(settings, /Tus datos históricos se conservarán/);
  assert.match(settings, /onClick=\{\(\) => setConfirming\(true\)\}/);
  assert.match(settings, /onClose=\{\(\) => setConfirming\(false\)\}/);
  assert.match(settings, /onConfirm=\{\(\) => void close\(\)\}/);
  assert.doesNotMatch(`${settings}\n${setup}`, /window\.confirm|Salir del espacio/);
  assert.doesNotMatch(setup, /Cerrar espacio|household\/leave/);
});

test('confirmed close uses the existing lifecycle endpoint and redirects to the new archive', async () => {
  let request: { url: string; init: RequestInit } | undefined;
  await closeHousehold(householdId, async (url, init) => {
    request = { url, init };
    return { ok: true };
  });
  const settings = await source('../src/app/dashboard/household/settings/page.tsx');

  assert.equal(request?.url, '/api/household/leave');
  assert.equal(request?.init.method, 'POST');
  assert.deepEqual(JSON.parse(String(request?.init.body)), { household_id: householdId });
  assert.match(settings, /refresh\(\)/);
  assert.match(settings, /router\.replace\(`\/dashboard\/household\/archive\/\$\{current\.id\}`\)/);
  assert.match(settings, /router\.refresh\(\)/);
});

test('failed close stays on the active page and exposes only controlled copy', async () => {
  await assert.rejects(
    closeHousehold(householdId, async () => ({ ok: false })),
    /No pudimos cerrar el espacio\. No se realizaron cambios\./
  );
  const settings = await source('../src/app/dashboard/household/settings/page.tsx');

  assert.match(settings, /catch \{/);
  assert.match(settings, /setError\('No pudimos cerrar el espacio\. No se realizaron cambios\.'\)/);
});

test('archived detail remains read-only and never offers closing again', async () => {
  const archive = await source('../src/app/dashboard/household/archive/[householdId]/page.tsx');

  assert.match(archive, /readOnly/);
  assert.doesNotMatch(archive, /Cerrar espacio|closeHousehold|household\/leave/);
});
