import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error -- TypeScript disallows .ts extensions unless enabled globally.
import { householdActivityItemSchema, householdActivityPageResponseSchema, householdActivityResponseSchema, householdBalanceResponseSchema, householdPendingSettlementSchema, householdSettlementCreateSchema, householdSettlementResponseSchema, settlementFundingSourceSchema, settlementStatusSchema } from '../src/lib/validation/household.ts';

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

test('householdSettlementCreateSchema enforces funding source requirements', () => {
  const base = {
    household_id: householdId,
    amount: '100.00',
    date: '2026-09-06',
  };
  const personalAcct = '80000000-0000-4000-8000-000000000007';
  const householdAcct = '80000000-0000-4000-8000-000000000008';

  // 1. personal_account requires source_personal_account_id
  assert.equal(
    householdSettlementCreateSchema.safeParse({
      ...base,
      funding_source: 'personal_account',
      source_personal_account_id: personalAcct,
    }).success,
    true
  );
  assert.equal(
    householdSettlementCreateSchema.safeParse({
      ...base,
      funding_source: 'personal_account',
    }).success,
    false,
    'personal_account without source_personal_account_id must fail'
  );
  assert.equal(
    householdSettlementCreateSchema.safeParse({
      ...base,
      funding_source: 'personal_account',
      source_personal_account_id: personalAcct,
      source_household_account_id: householdAcct,
    }).success,
    false,
    'personal_account with source_household_account_id must fail'
  );

  // 2. household_account requires source_household_account_id
  assert.equal(
    householdSettlementCreateSchema.safeParse({
      ...base,
      funding_source: 'household_account',
      source_household_account_id: householdAcct,
    }).success,
    true
  );
  assert.equal(
    householdSettlementCreateSchema.safeParse({
      ...base,
      funding_source: 'household_account',
    }).success,
    false,
    'household_account without source_household_account_id must fail'
  );
  assert.equal(
    householdSettlementCreateSchema.safeParse({
      ...base,
      funding_source: 'household_account',
      source_household_account_id: householdAcct,
      source_personal_account_id: personalAcct,
    }).success,
    false,
    'household_account with source_personal_account_id must fail'
  );

  // 3. cash requires no accounts linked
  assert.equal(
    householdSettlementCreateSchema.safeParse({
      ...base,
      funding_source: 'cash',
    }).success,
    true
  );
  assert.equal(
    householdSettlementCreateSchema.safeParse({
      ...base,
      funding_source: 'cash',
      source_personal_account_id: personalAcct,
    }).success,
    false,
    'cash with personal account must fail'
  );
  assert.equal(
    householdSettlementCreateSchema.safeParse({
      ...base,
      funding_source: 'cash',
      source_household_account_id: householdAcct,
    }).success,
    false,
    'cash with household account must fail'
  );

  // 4. in_kind requires no accounts linked
  assert.equal(
    householdSettlementCreateSchema.safeParse({
      ...base,
      funding_source: 'in_kind',
    }).success,
    true
  );
  assert.equal(
    householdSettlementCreateSchema.safeParse({
      ...base,
      funding_source: 'in_kind',
      source_personal_account_id: personalAcct,
    }).success,
    false,
    'in_kind with personal account must fail'
  );

  // 5. Invalid funding source enum must fail
  assert.equal(
    householdSettlementCreateSchema.safeParse({
      ...base,
      funding_source: 'crypto',
    }).success,
    false,
    'Invalid funding source must fail'
  );
});

test('householdSettlementResponseSchema validates all status variants and funding sources', () => {
  const base = {
    id: settlementId,
    entry_type: 'settlement' as const,
    household_id: householdId,
    payer_user_id: userA,
    payee_user_id: userB,
    recorded_by_user_id: userA,
    amount: '75.00',
    date: '2026-09-06',
    notes: null,
    is_cancelled: false,
    created_at: '2026-09-06T15:30:00.000Z',
  };

  // Valid statuses
  for (const status of ['pending', 'confirmed', 'rejected', 'cancelled'] as const) {
    assert.equal(
      householdSettlementResponseSchema.safeParse({
        ...base,
        status,
        is_cancelled: status === 'cancelled',
      }).success,
      true,
      `Status ${status} must be valid`
    );
  }

  // Valid funding sources
  for (const funding_source of ['personal_account', 'household_account', 'cash', 'in_kind'] as const) {
    assert.equal(
      householdSettlementResponseSchema.safeParse({
        ...base,
        funding_source,
      }).success,
      true,
      `Funding source ${funding_source} must be valid`
    );
  }

  // Invalid status
  assert.equal(
    householdSettlementResponseSchema.safeParse({ ...base, status: 'approved' }).success,
    false
  );

  // Invalid funding source
  assert.equal(
    householdSettlementResponseSchema.safeParse({ ...base, funding_source: 'credit_card' }).success,
    false
  );
});

test('householdBalanceResponseSchema accepts and validates pending_settlement contract', () => {
  const validBalanceWithoutPending = {
    household_id: householdId,
    currency: 'MXN' as const,
    positions: [
      { user_id: userA, amount: '50.00' },
      { user_id: userB, amount: '-50.00' },
    ],
    owed_by_user_id: userB,
    owed_to_user_id: userA,
    amount: '50.00',
    pending_settlement: null,
  };

  assert.equal(householdBalanceResponseSchema.safeParse(validBalanceWithoutPending).success, true);

  const pendingSettlement = {
    id: settlementId,
    payer_user_id: userB,
    payee_user_id: userA,
    amount: '20.00',
    funding_source: 'personal_account' as const,
    date: '2026-09-06',
    notes: 'Pago parcial',
    created_at: '2026-09-06T12:00:00.000Z',
  };

  const validBalanceWithPending = {
    ...validBalanceWithoutPending,
    pending_settlement: pendingSettlement,
  };

  assert.equal(householdBalanceResponseSchema.safeParse(validBalanceWithPending).success, true);
  assert.equal(householdPendingSettlementSchema.safeParse(pendingSettlement).success, true);

  // Rejects if pending_settlement has identical payer and payee
  assert.equal(
    householdPendingSettlementSchema.safeParse({ ...pendingSettlement, payee_user_id: userB }).success,
    false
  );

  // Rejects invalid amount in pending_settlement
  assert.equal(
    householdPendingSettlementSchema.safeParse({ ...pendingSettlement, amount: '0.00' }).success,
    false
  );
  assert.equal(
    householdPendingSettlementSchema.safeParse({ ...pendingSettlement, amount: '-10.00' }).success,
    false
  );

  // Rejects invalid date in pending_settlement
  assert.equal(
    householdPendingSettlementSchema.safeParse({ ...pendingSettlement, date: '2026-02-30' }).success,
    false
  );
});

test('settlementFundingSourceSchema and settlementStatusSchema validate correctly', () => {
  for (const source of ['personal_account', 'household_account', 'cash', 'in_kind']) {
    assert.equal(settlementFundingSourceSchema.safeParse(source).success, true, source);
  }
  assert.equal(settlementFundingSourceSchema.safeParse('crypto').success, false);

  for (const status of ['pending', 'confirmed', 'rejected', 'cancelled']) {
    assert.equal(settlementStatusSchema.safeParse(status).success, true, status);
  }
  assert.equal(settlementStatusSchema.safeParse('completed').success, false);
});

