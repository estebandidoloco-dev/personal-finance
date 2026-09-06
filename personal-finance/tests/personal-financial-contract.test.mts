import assert from 'node:assert/strict';
import test from 'node:test';
// Node's native type-stripping loader requires the extension; the app uses bundler resolution.
// @ts-expect-error -- TypeScript disallows .ts extensions unless enabled globally.
import { accountCreateSchema, accountUpdateSchema, personalAccountResponseSchema, personalTransactionResponseSchema, transactionMutationSchema } from '../src/lib/validation/financial.ts';

const accountId = '72000000-0000-4000-8000-000000000001';

test('personal account mutations accept only canonical exact signed money', () => {
  const base = { name: 'Cuenta', type: 'checking', initial_balance: '999999999999.99' };
  assert.equal(accountCreateSchema.safeParse(base).success, true);
  for (const initial_balance of [100, 100.5, '100', '01.00', '1e2', '1,000.00', '-0.00']) {
    assert.equal(accountCreateSchema.safeParse({ ...base, initial_balance }).success, false, String(initial_balance));
  }
  assert.equal(accountCreateSchema.safeParse({ ...base, currency: 'MXN' }).success, false);
  assert.equal(accountUpdateSchema.safeParse({ currency: 'USD' }).success, false);
});

test('personal transaction mutations accept only canonical positive exact money', () => {
  const base = {
    account_id: accountId,
    kind: 'expense',
    amount: '999999999999.99',
    date: '2026-09-05',
    description: 'Exacta',
  };
  assert.equal(transactionMutationSchema.safeParse(base).success, true);
  for (const amount of [100, 100.5, '100', '01.00', '1e2', '1,000.00', '0.00', '-0.00']) {
    assert.equal(transactionMutationSchema.safeParse({ ...base, amount }).success, false, String(amount));
  }
  assert.equal(transactionMutationSchema.safeParse({ ...base, currency: 'MXN' }).success, false);
  assert.equal(transactionMutationSchema.safeParse({ ...base, date: '2026-02-29' }).success, false);
});

test('personal financial responses preserve large money as strings', () => {
  const account = personalAccountResponseSchema.parse({
    id: accountId,
    user_id: '72000000-0000-4000-8000-000000000003',
    name: 'Cuenta',
    type: 'checking',
    currency: 'MXN',
    initial_balance: '999999999999.99',
    balance: '-999999999999.99',
    is_shared: false,
    institution: null,
    created_at: null,
    last_synced_at: null,
  });
  const transaction = personalTransactionResponseSchema.parse({
    id: '72000000-0000-4000-8000-000000000002',
    user_id: '72000000-0000-4000-8000-000000000003',
    account_id: accountId,
    category_id: null,
    kind: 'expense',
    currency: 'MXN',
    amount: '999999999999.99',
    date: '2026-09-05',
    description: 'Exacta',
    notes: null,
    is_shared: false,
    split_ratio: null,
    status: 'pending',
    source: 'manual',
    source_provider: null,
    external_id: null,
    import_match_hash: null,
    csv_import_id: null,
    created_at: null,
    updated_at: null,
    category: null,
    tags: [],
  });
  assert.equal(typeof account.balance, 'string');
  assert.equal(transaction.amount, '999999999999.99');
  assert.equal(personalTransactionResponseSchema.safeParse({ ...transaction, amount: 999999999999.99 }).success, false);
});
