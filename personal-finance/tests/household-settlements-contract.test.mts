import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error -- TypeScript disallows .ts extensions unless enabled globally.
import { householdActivityItemSchema, householdActivityPageResponseSchema, householdActivityResponseSchema, householdSettlementCreateSchema, householdSettlementResponseSchema } from '../src/lib/validation/household.ts';

const householdId = '80000000-0000-4000-8000-000000000001';
const userA = '80000000-0000-4000-8000-000000000002';
const userB = '80000000-0000-4000-8000-000000000003';
const idempotencyKey = '80000000-0000-4000-8000-000000000004';
const settlementId = '80000000-0000-4000-8000-000000000005';

test('householdSettlementCreateSchema accepts valid inputs', () => {
  const complete = {
    household_id: householdId,
    amount: '150.75',
    date: '2026-09-06',
    notes: 'Reembolso gastos compartidos',
    idempotency_key: idempotencyKey,
  };
  assert.equal(householdSettlementCreateSchema.safeParse(complete).success, true);

  const minimal = {
    household_id: householdId,
    amount: '0.01',
    date: '2026-09-06',
  };
  assert.equal(householdSettlementCreateSchema.safeParse(minimal).success, true);

  const withNullNotes = {
    household_id: householdId,
    amount: '10.00',
    date: '2026-09-06',
    notes: null,
  };
  assert.equal(householdSettlementCreateSchema.safeParse(withNullNotes).success, true);
});

test('householdSettlementCreateSchema rejects non-canonical or negative money amounts', () => {
  const base = {
    household_id: householdId,
    date: '2026-09-06',
  };

  const invalidAmounts = [
    '0.00',
    '-0.00',
    '-10.00',
    '10',
    10,
    '10.0',
    '10.000',
    '010.00',
    '1,000.00',
    '1e2',
    'NaN',
    '',
    null,
    undefined,
  ];

  for (const amount of invalidAmounts) {
    const result = householdSettlementCreateSchema.safeParse({ ...base, amount });
    assert.equal(result.success, false, `Expected amount '${String(amount)}' to be rejected`);
  }
});

test('householdSettlementCreateSchema rejects invalid calendar dates', () => {
  const base = {
    household_id: householdId,
    amount: '50.00',
  };

  const invalidDates = [
    '2026-02-29', // 2026 is not a leap year
    '2026-02-30',
    '2026-04-31',
    '2026-13-01',
    '2026-00-15',
    '2026/09/06',
    '06-09-2026',
    '2026-9-6',
    'today',
    '',
    null,
    undefined,
  ];

  for (const date of invalidDates) {
    const result = householdSettlementCreateSchema.safeParse({ ...base, date });
    assert.equal(result.success, false, `Expected date '${String(date)}' to be rejected`);
  }
});

test('householdSettlementCreateSchema rejects notes over 500 characters and extra fields', () => {
  const base = {
    household_id: householdId,
    amount: '50.00',
    date: '2026-09-06',
  };

  // Notes > 500 chars
  assert.equal(
    householdSettlementCreateSchema.safeParse({ ...base, notes: 'a'.repeat(501) }).success,
    false,
    'Expected note with 501 chars to be rejected'
  );
  assert.equal(
    householdSettlementCreateSchema.safeParse({ ...base, notes: 'a'.repeat(500) }).success,
    true,
    'Expected note with 500 chars to be accepted'
  );

  // Rejects injected fields (strict)
  const forbiddenKeys = [
    { payer_user_id: userA },
    { payee_user_id: userB },
    { recorded_by_user_id: userA },
    { currency: 'MXN' },
    { status: 'posted' },
    { id: settlementId },
  ];

  for (const extra of forbiddenKeys) {
    assert.equal(
      householdSettlementCreateSchema.safeParse({ ...base, ...extra }).success,
      false,
      `Expected extra key '${Object.keys(extra)[0]}' to be rejected`
    );
  }
});

test('householdSettlementResponseSchema validates correct responses and enforces distinct members', () => {
  const valid = {
    id: settlementId,
    entry_type: 'settlement' as const,
    household_id: householdId,
    payer_user_id: userA,
    payee_user_id: userB,
    recorded_by_user_id: userB,
    amount: '75.50',
    date: '2026-09-06',
    notes: 'Abono',
    is_cancelled: false,
    created_at: '2026-09-06T15:30:00.000Z',
  };

  assert.equal(householdSettlementResponseSchema.safeParse(valid).success, true);

  // Same payer and payee must fail
  assert.equal(
    householdSettlementResponseSchema.safeParse({ ...valid, payee_user_id: userA }).success,
    false,
    'Expected identical payer and payee to be rejected'
  );

  // Invalid money in response must fail
  assert.equal(
    householdSettlementResponseSchema.safeParse({ ...valid, amount: '-75.50' }).success,
    false
  );
  assert.equal(
    householdSettlementResponseSchema.safeParse({ ...valid, amount: '0.00' }).success,
    false
  );
});

test('householdActivityItemSchema accepts settlement as discriminated union variant', () => {
  const settlementItem = {
    id: settlementId,
    entry_type: 'settlement' as const,
    household_id: householdId,
    payer_user_id: userA,
    payee_user_id: userB,
    recorded_by_user_id: userA,
    amount: '100.00',
    date: '2026-09-06',
    notes: null,
    is_cancelled: false,
    created_at: '2026-09-06T12:00:00.000Z',
  };

  assert.equal(householdActivityItemSchema.safeParse(settlementItem).success, true);
  assert.equal(householdActivityResponseSchema.safeParse(settlementItem).success, true);

  // Rejects if payer and payee are the same
  assert.equal(
    householdActivityItemSchema.safeParse({ ...settlementItem, payee_user_id: userA }).success,
    false
  );
});

test('householdActivityPageResponseSchema validates pages with mixed activities', () => {
  const settlementItem = {
    id: settlementId,
    entry_type: 'settlement' as const,
    household_id: householdId,
    payer_user_id: userA,
    payee_user_id: userB,
    recorded_by_user_id: userA,
    amount: '100.00',
    date: '2026-09-06',
    notes: null,
    is_cancelled: false,
    created_at: '2026-09-06T12:00:00.000Z',
  };

  const expenseItem = {
    id: '80000000-0000-4000-8000-000000000006',
    entry_type: 'shared_expense' as const,
    household_expense_id: '80000000-0000-4000-8000-000000000006',
    funding_source: 'personal_account' as const,
    personal_payer_user_id: userB,
    recorded_by_user_id: userB,
    account_id: null,
    kind: 'expense' as const,
    amount: '200.00',
    currency: 'MXN' as const,
    date: '2026-09-05',
    description: 'Súper semanal',
    notes: null,
    status: 'posted' as const,
    split_mode: 'equal' as const,
    category_id: null,
    category: null,
    splits: [
      { user_id: userA, amount: '100.00' },
      { user_id: userB, amount: '100.00' },
    ],
    created_at: '2026-09-05T10:00:00.000Z',
    updated_at: '2026-09-05T10:00:00.000Z',
  };

  const page = {
    items: [settlementItem, expenseItem],
    next_cursor: 'eyJ2ZXJzaW9uIjoxLCJkYXRlIjoiMjAyNi0wOS0wNSJ9',
  };

  assert.equal(householdActivityPageResponseSchema.safeParse(page).success, true);
});
