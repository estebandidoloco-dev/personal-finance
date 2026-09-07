import assert from 'node:assert/strict';
import test from 'node:test';
// Node's native type-stripping loader requires the extension; the app uses bundler resolution.
// @ts-expect-error -- TypeScript disallows .ts extensions unless enabled globally.
import { exactAggregateSignedMoneySchema, exactPositiveMoneySchema, exactSignedMoneySchema, financialDateSchema, householdAccountCreateSchema, householdBalanceResponseSchema, householdContributionCreateSchema, householdContributionResponseSchema, householdInvitationCreateSchema, sharedExpenseCreateSchema } from '../src/lib/validation/household.ts';

const userA = '64000000-0000-4000-8000-000000000001';
const userB = '64000000-0000-4000-8000-000000000002';
const fakeUser = '64000000-0000-4000-8000-000000000003';
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

test('archived forming Household accepts one real zero position', () => {
  assert.equal(householdBalanceResponseSchema.safeParse({
    household_id: baseExpense.household_id,
    currency: 'MXN',
    positions: [{ user_id: userA, amount: '0.00' }],
    owed_by_user_id: null,
    owed_to_user_id: null,
    amount: '0.00',
  }).success, true);
});

test('interpersonal balance contract derives debtor and creditor from positions', () => {
  const zeroBalance = {
    household_id: baseExpense.household_id,
    currency: 'MXN' as const,
    positions: [
      { user_id: userA, amount: '0.00' },
      { user_id: userB, amount: '0.00' },
    ],
    owed_by_user_id: null,
    owed_to_user_id: null,
    amount: '0.00',
  };
  const realDebt = {
    ...zeroBalance,
    positions: [
      { user_id: userA, amount: '50.00' },
      { user_id: userB, amount: '-50.00' },
    ],
    owed_by_user_id: userB,
    owed_to_user_id: userA,
    amount: '50.00',
  };

  assert.equal(householdBalanceResponseSchema.safeParse(zeroBalance).success, true);
  assert.equal(householdBalanceResponseSchema.safeParse(realDebt).success, true);

  const invalidBalances = [
    {
      label: 'single with owed_by',
      value: { ...zeroBalance, positions: [{ user_id: userA, amount: '0.00' }], owed_by_user_id: userA },
    },
    {
      label: 'single with owed_to',
      value: { ...zeroBalance, positions: [{ user_id: userA, amount: '0.00' }], owed_to_user_id: userA },
    },
    {
      label: 'single with both IDs',
      value: {
        ...zeroBalance,
        positions: [{ user_id: userA, amount: '0.00' }],
        owed_by_user_id: userA,
        owed_to_user_id: fakeUser,
      },
    },
    {
      label: 'single with non-zero position',
      value: { ...zeroBalance, positions: [{ user_id: userA, amount: '1.00' }], amount: '1.00' },
    },
    { label: 'zero balance with IDs', value: { ...zeroBalance, owed_by_user_id: userB, owed_to_user_id: userA } },
    { label: 'inverted IDs', value: { ...realDebt, owed_by_user_id: userA, owed_to_user_id: userB } },
    { label: 'fake owed_by', value: { ...realDebt, owed_by_user_id: fakeUser } },
    { label: 'fake owed_to', value: { ...realDebt, owed_to_user_id: fakeUser } },
    { label: 'same IDs', value: { ...realDebt, owed_by_user_id: userA, owed_to_user_id: userA } },
    { label: 'only owed_by null', value: { ...realDebt, owed_by_user_id: null } },
    { label: 'only owed_to null', value: { ...realDebt, owed_to_user_id: null } },
    { label: 'real debt with both IDs null', value: { ...realDebt, owed_by_user_id: null, owed_to_user_id: null } },
    { label: 'wrong amount', value: { ...realDebt, amount: '49.99' } },
    {
      label: 'two positive positions',
      value: { ...realDebt, positions: [{ user_id: userA, amount: '50.00' }, { user_id: userB, amount: '50.00' }] },
    },
    {
      label: 'two negative positions',
      value: { ...realDebt, positions: [{ user_id: userA, amount: '-50.00' }, { user_id: userB, amount: '-50.00' }] },
    },
    {
      label: 'duplicate user_id',
      value: { ...realDebt, positions: [{ user_id: userA, amount: '50.00' }, { user_id: userA, amount: '-50.00' }] },
    },
    {
      label: 'invalid money',
      value: { ...realDebt, positions: [{ user_id: userA, amount: '5e1' }, { user_id: userB, amount: '-50.00' }] },
    },
  ];

  for (const { label, value } of invalidBalances) {
    assert.doesNotThrow(() => householdBalanceResponseSchema.safeParse(value), label);
    assert.equal(householdBalanceResponseSchema.safeParse(value).success, false, label);
  }
});

test('interpersonal balance safeParse never throws for malformed money', () => {
  for (const invalid of ['1e16', '1,000.00', ' 1.00', '1.0', '-0.00']) {
    assert.doesNotThrow(() => {
      householdBalanceResponseSchema.safeParse({
        household_id: baseExpense.household_id,
        currency: 'MXN',
        positions: [
          { user_id: userA, amount: invalid },
          { user_id: userB, amount: '0.00' },
        ],
        owed_by_user_id: null,
        owed_to_user_id: null,
        amount: invalid,
      });
    });
    assert.equal(householdBalanceResponseSchema.safeParse({
      household_id: baseExpense.household_id,
      currency: 'MXN',
      positions: [
        { user_id: userA, amount: invalid },
        { user_id: userB, amount: '0.00' },
      ],
      owed_by_user_id: null,
      owed_to_user_id: null,
      amount: invalid,
    }).success, false, invalid);
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

test('contribution contracts keep exact money and private linkage out of the response', () => {
  const input = {
    household_id: baseExpense.household_id,
    source_personal_account_id: baseExpense.source_account_id,
    destination_household_account_id: '64200000-0000-4000-8000-000000000002',
    amount: '10.01',
    date: baseExpense.date,
    note: 'Fondo',
    idempotency_key: '64300000-0000-4000-8000-000000000001',
  };
  assert.equal(householdContributionCreateSchema.safeParse(input).success, true);
  for (const amount of [10.01, '0.00', '-0.00', '01.00', '1e3']) {
    assert.equal(householdContributionCreateSchema.safeParse({ ...input, amount }).success, false, String(amount));
  }
  assert.equal(householdContributionCreateSchema.safeParse({ ...input, currency: 'MXN' }).success, false);

  const response = {
    id: '64400000-0000-4000-8000-000000000001',
    household_id: input.household_id,
    contributed_by_user_id: userA,
    recorded_by_user_id: userA,
    destination_household_account_id: input.destination_household_account_id,
    amount: input.amount,
    currency: 'MXN' as const,
    date: input.date,
    note: input.note,
    status: 'posted' as const,
    created_at: '2026-09-06T12:00:00.000Z',
    cancelled_at: null,
  };
  assert.equal(householdContributionResponseSchema.safeParse(response).success, true);
  for (const privateField of ['source_personal_account_id', 'personal_transaction_id', 'idempotency_key']) {
    assert.equal(householdContributionResponseSchema.safeParse({ ...response, [privateField]: input.source_personal_account_id }).success, false);
  }
  assert.equal(householdContributionResponseSchema.safeParse({ ...response, recorded_by_user_id: userB }).success, false);
  assert.equal(householdContributionResponseSchema.safeParse({ ...response, status: 'cancelled' }).success, false);
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
