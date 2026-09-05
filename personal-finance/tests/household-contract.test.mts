import assert from 'node:assert/strict';
import test from 'node:test';
// Node's native type-stripping loader requires the extension; the app uses bundler resolution.
// @ts-expect-error -- TypeScript disallows .ts extensions unless enabled globally.
import { exactAggregateSignedMoneySchema, exactPositiveMoneySchema, exactSignedMoneySchema, financialDateSchema, householdAccountCreateSchema, householdBalanceResponseSchema, householdInvitationCreateSchema, sharedExpenseCreateSchema } from '../src/lib/validation/household.ts';

const userA = '64000000-0000-4000-8000-000000000001';
const userB = '64000000-0000-4000-8000-000000000002';
const baseExpense = {
  household_id: '64100000-0000-4000-8000-000000000001',
  funding_source: 'personal_account' as const,
  source_account_id: '64200000-0000-4000-8000-000000000001',
  amount: '10.00',
  date: '2026-09-05',
  description: 'Cena',
  split_mode: 'equal' as const,
  splits: null,
};

test('money contracts accept only canonical exact strings', () => {
  for (const value of ['0.01', '10.00', '999999999999.99']) {
    assert.equal(exactPositiveMoneySchema.safeParse(value).success, true, value);
  }
  for (const value of ['0.00', '-0.00', '-0.01', '01.00', '1', '1.0', '1.000', 1]) {
    assert.equal(exactPositiveMoneySchema.safeParse(value).success, false, String(value));
  }
  assert.equal(exactSignedMoneySchema.safeParse('-0.01').success, true);
  assert.equal(exactSignedMoneySchema.safeParse('-0.00').success, false);
});

test('interpersonal balance contract accepts unbounded exact aggregate strings', () => {
  const amount = '1000999999999989.99';
  assert.equal(exactAggregateSignedMoneySchema.safeParse(amount).success, true);
  assert.equal(householdBalanceResponseSchema.safeParse({
    household_id: baseExpense.household_id,
    currency: 'MXN',
    positions: [
      { user_id: userA, amount },
      { user_id: userB, amount: `-${amount}` },
    ],
    owed_by_user_id: userB,
    owed_to_user_id: userA,
    amount,
  }).success, true);
  for (const invalid of ['1e16', '1E16', '1,000.00', ' 1.00', '-0.00']) {
    assert.equal(exactAggregateSignedMoneySchema.safeParse(invalid).success, false, invalid);
  }
});

test('financial DATE validation does not use UTC conversion', () => {
  assert.equal(financialDateSchema.safeParse('2028-02-29').success, true);
  for (const value of ['2026-02-29', '2026-13-01', '2026-04-31', '2026-09-05T00:00:00Z']) {
    assert.equal(financialDateSchema.safeParse(value).success, false, value);
  }
});

test('Household account contract never accepts currency', () => {
  assert.equal(householdAccountCreateSchema.safeParse({
    household_id: baseExpense.household_id,
    name: 'Común',
    type: 'cash',
    initial_balance: '0.00',
  }).success, true);
  assert.equal(householdAccountCreateSchema.safeParse({
    household_id: baseExpense.household_id,
    name: 'USD',
    type: 'cash',
    initial_balance: '0.00',
    currency: 'USD',
  }).success, false);
});

test('shared expense contract rejects forged identities and invalid split shapes', () => {
  assert.equal(sharedExpenseCreateSchema.safeParse(baseExpense).success, true);
  for (const forbidden of ['personal_payer_user_id', 'recorded_by_user_id', 'currency']) {
    assert.equal(sharedExpenseCreateSchema.safeParse({ ...baseExpense, [forbidden]: userA }).success, false);
  }
  assert.equal(sharedExpenseCreateSchema.safeParse({ ...baseExpense, splits: [
    { user_id: userA, amount: '5.00' }, { user_id: userB, amount: '5.00' },
  ] }).success, false);
  assert.equal(sharedExpenseCreateSchema.safeParse({
    ...baseExpense,
    split_mode: 'custom',
    splits: [{ user_id: userA, amount: '10.00' }, { user_id: userB, amount: '0.00' }],
  }).success, true);
  assert.equal(sharedExpenseCreateSchema.safeParse({
    ...baseExpense,
    split_mode: 'custom',
    splits: [{ user_id: userA, amount: '5.00' }, { user_id: userA, amount: '5.00' }],
  }).success, false);
  assert.equal(sharedExpenseCreateSchema.safeParse({
    ...baseExpense,
    split_mode: 'custom',
    splits: [{ user_id: userA, amount: '0.00' }, { user_id: userB, amount: '0.00' }],
  }).success, false);
});

test('invitation email is normalized without account discovery', () => {
  const parsed = householdInvitationCreateSchema.parse({
    household_id: baseExpense.household_id,
    invited_email: '  Partner@Example.Test ',
  });
  assert.equal(parsed.invited_email, 'partner@example.test');
});
