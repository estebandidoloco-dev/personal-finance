import assert from 'node:assert/strict';
import test from 'node:test';
// Node's native type-stripping loader requires the extension; the app uses bundler resolution.
// @ts-expect-error -- TypeScript disallows .ts extensions unless enabled globally.
import { householdActivityPageResponseSchema, householdExpenseDetailResponseSchema } from '../src/lib/validation/household.ts';

const userA = '58000000-0000-4000-8000-000000000001';
const userB = '58000000-0000-4000-8000-000000000002';
const accountId = '58100000-0000-4000-8000-000000000001';
const base = {
  id: '58200000-0000-4000-8000-000000000001',
  household_id: '58300000-0000-4000-8000-000000000001',
  funding_source: 'personal_account' as const,
  source_account_id: accountId,
  personal_payer_user_id: userA,
  recorded_by_user_id: userA,
  split_mode: 'custom' as const,
  category_id: null,
  category: null,
  amount: '10.01',
  currency: 'MXN' as const,
  date: '2026-09-05',
  description: 'Cena',
  notes: 'privada',
  status: 'posted' as const,
  splits: [
    { user_id: userA, amount: '5.00' },
    { user_id: userB, amount: '5.01' },
  ],
  created_at: '2026-09-05T12:00:00.000Z',
  updated_at: '2026-09-05T12:00:00.000Z',
};

test('accepts the exact personal and household variants without actor inference', () => {
  assert.equal(householdExpenseDetailResponseSchema.safeParse(base).success, true);
  assert.equal(householdExpenseDetailResponseSchema.safeParse({ ...base, source_account_id: null, notes: null }).success, true);
  assert.equal(householdExpenseDetailResponseSchema.safeParse({
    ...base,
    funding_source: 'household_account',
    source_account_id: accountId,
    personal_payer_user_id: null,
  }).success, true);
});

test('rejects non-canonical money, numeric money and invalid dates', () => {
  for (const amount of [-0, 10.01, '-0.00', '1e1', '10', '01.00', '1,000.00', ' 10.01']) {
    assert.equal(householdExpenseDetailResponseSchema.safeParse({ ...base, amount }).success, false);
  }
  assert.equal(householdExpenseDetailResponseSchema.safeParse({ ...base, date: '2026-02-29' }).success, false);
});

test('rejects duplicate users, incorrect exact sum and extra keys', () => {
  assert.equal(householdExpenseDetailResponseSchema.safeParse({
    ...base,
    splits: [{ user_id: userA, amount: '5.00' }, { user_id: userA, amount: '5.01' }],
  }).success, false);
  assert.equal(householdExpenseDetailResponseSchema.safeParse({
    ...base,
    splits: [{ user_id: userA, amount: '5.00' }, { user_id: userB, amount: '5.00' }],
  }).success, false);
  assert.equal(householdExpenseDetailResponseSchema.safeParse({ ...base, leaked: true }).success, false);
});

test('enforces the discriminated source invariants', () => {
  assert.equal(householdExpenseDetailResponseSchema.safeParse({
    ...base, funding_source: 'personal_account', personal_payer_user_id: null,
  }).success, false);
  assert.equal(householdExpenseDetailResponseSchema.safeParse({
    ...base, funding_source: 'household_account', personal_payer_user_id: null, source_account_id: null,
  }).success, false);
});

test('accepts only a strict coherent global-category projection', () => {
  const category = {
    id: '58400000-0000-4000-8000-000000000001', name: 'Vivienda', color: '#112233',
  };
  assert.equal(householdExpenseDetailResponseSchema.safeParse({
    ...base, category_id: category.id, category,
  }).success, true);
  for (const invalidCategory of [
    { ...category, user_id: userA },
    { ...category, name: '' },
    { ...category, id: userB },
  ]) {
    assert.equal(householdExpenseDetailResponseSchema.safeParse({
      ...base, category_id: category.id, category: invalidCategory,
    }).success, false);
  }
});

test('strict activity pages require category on every item', () => {
  const category = {
    id: '58400000-0000-4000-8000-000000000001', name: 'Vivienda', color: null,
  };
  const activity = {
    id: base.id,
    entry_type: 'shared_expense',
    household_expense_id: base.id,
    funding_source: 'personal_account',
    personal_payer_user_id: userA,
    recorded_by_user_id: userA,
    account_id: null,
    kind: 'expense',
    amount: base.amount,
    currency: 'MXN',
    date: base.date,
    description: base.description,
    notes: null,
    status: base.status,
    split_mode: base.split_mode,
    category_id: category.id,
    category,
    splits: base.splits,
    created_at: base.created_at,
    updated_at: base.updated_at,
  };
  assert.equal(householdActivityPageResponseSchema.safeParse({
    items: [activity], next_cursor: null,
  }).success, true);
  const withoutCategory: Record<string, unknown> = { ...activity };
  delete withoutCategory.category;
  assert.equal(householdActivityPageResponseSchema.safeParse({
    items: [withoutCategory], next_cursor: null,
  }).success, false);
});
