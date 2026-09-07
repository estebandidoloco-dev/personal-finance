import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';
import test from 'node:test';
// @ts-expect-error Node type stripping requires source extensions.
// prettier-ignore
import { archivedBalancePresentation } from '../src/lib/household/presentation.ts';

register('./path-alias-loader.mjs', import.meta.url);

// @ts-expect-error Node type stripping requires source extensions.
// prettier-ignore
const { parseArchivedHouseholdResources } = await import('../src/lib/household/archive-resource.ts');

const userA = '64000000-0000-4000-8000-000000000001';
const userB = '64000000-0000-4000-8000-000000000002';
const userC = '64000000-0000-4000-8000-000000000003';
const householdId = '64100000-0000-4000-8000-000000000001';
const member = (userId: string, displayName: string) => ({
  user_id: userId,
  display_name: displayName,
  avatar_url: null,
  status: 'archived' as const,
  joined_at: '2026-09-01T12:00:00.000Z',
  ended_at: '2026-09-02T12:00:00.000Z',
});
const archive = (members: Array<{ user_id: string; display_name: string | null }>) => ({
  id: householdId,
  name: 'Casa',
  status: 'closed' as const,
  currency: 'MXN' as const,
  created_at: '2026-09-01T12:00:00.000Z',
  activated_at: null,
  closed_at: '2026-09-02T12:00:00.000Z',
  members,
});
const balance = (positions: Array<{ user_id: string; amount: string }>) => ({
  household_id: householdId,
  currency: 'MXN' as const,
  positions,
  owed_by_user_id: null as string | null,
  owed_to_user_id: null as string | null,
  amount: '0.00',
});

test('single-member API payload follows the real archive parser into presentation', () => {
  const resources = parseArchivedHouseholdResources({
    archive: archive([{ user_id: userA, display_name: 'Esteban' }]),
    members: [member(userA, 'Esteban')],
    balance: balance([{ user_id: userA, amount: '0.00' }]),
  });
  const presentation = archivedBalancePresentation(
    resources.members.length,
    resources.balance,
    userA,
    ''
  );

  assert.deepEqual(presentation, {
    label: null,
    title: 'Sin balance pendiente',
    amount: null,
    helper: 'Este espacio se cerró antes de que la otra persona se uniera.',
  });
  assert.doesNotMatch(JSON.stringify(presentation), /Balance entre ustedes|Debías a|te debía/);
});

test('two-member archive preserves debt and zero-balance presentation', () => {
  const resources = parseArchivedHouseholdResources({
    archive: archive([
      { user_id: userA, display_name: 'Esteban' },
      { user_id: userB, display_name: 'Vale' },
    ]),
    members: [member(userA, 'Esteban'), member(userB, 'Vale')],
    balance: {
      ...balance([
        { user_id: userA, amount: '-50.00' },
        { user_id: userB, amount: '50.00' },
      ]),
      owed_by_user_id: userA,
      owed_to_user_id: userB,
      amount: '50.00',
    },
  });
  const debt = archivedBalancePresentation(
    resources.members.length,
    resources.balance,
    userA,
    'Vale'
  );
  const zero = archivedBalancePresentation(
    2,
    balance([
      { user_id: userA, amount: '0.00' },
      { user_id: userB, amount: '0.00' },
    ]),
    userA,
    'Vale'
  );

  assert.equal(debt.label, 'Balance entre ustedes · histórico');
  assert.equal(debt.title, 'Debías a Vale');
  assert.equal(debt.amount, '50.00');
  assert.equal(zero.title, 'Quedaron a mano');
  assert.equal(zero.amount, '0.00');
});

test('archive resource schemas reject member and position cardinalities outside one or two', () => {
  const valid = {
    archive: archive([{ user_id: userA, display_name: 'Esteban' }]),
    members: [member(userA, 'Esteban')],
    balance: balance([{ user_id: userA, amount: '0.00' }]),
  };

  for (const members of [[], [member(userA, 'A'), member(userB, 'B'), member(userC, 'C')]]) {
    assert.throws(
      () => parseArchivedHouseholdResources({ ...valid, members }),
      /La información de este espacio anterior no tiene el formato esperado/
    );
    assert.throws(
      () =>
        parseArchivedHouseholdResources({
          ...valid,
          archive: archive(members),
        }),
      /La información de este espacio anterior no tiene el formato esperado/
    );
  }
  for (const positions of [
    [],
    [
      { user_id: userA, amount: '0.00' },
      { user_id: userB, amount: '0.00' },
      { user_id: userC, amount: '0.00' },
    ],
  ]) {
    assert.throws(
      () => parseArchivedHouseholdResources({ ...valid, balance: balance(positions) }),
      /La información de este espacio anterior no tiene el formato esperado/
    );
  }
});

test('archived detail uses the tested resource parser and keeps all read-only sections', async () => {
  const page = await readFile(
    new URL('../src/app/dashboard/household/archive/[householdId]/page.tsx', import.meta.url),
    'utf8'
  );

  assert.match(page, /parseArchivedHouseholdResources\(\{/);
  assert.match(page, /members\.map/);
  assert.match(page, /members\.length === 2/);
  assert.match(page, /balancePresentation\.label &&/);
  assert.match(page, /balancePresentation\.amount &&/);
  assert.match(page, /HouseholdAccountsView householdId=\{householdId\} readOnly/);
  assert.match(page, /endpoint="expenses"/);
  assert.match(page, /endpoint="history"/);
  assert.doesNotMatch(page, /archivedMembersSchema|members\[[01]\]|\.length\(2\)\.parse/);
});
