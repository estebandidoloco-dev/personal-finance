import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error Node type stripping requires source extensions.
import { equalSplits, estimatedDebtChange, validateCustomSplits } from '../src/lib/money/exact-money.ts';

const members: [string, string] = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];

test('equal split gives the residual cent to the selected actor', () => {
  assert.deepEqual(equalSplits('10.01', members, members[1]), [
    { user_id: members[0], amount: '5.00' }, { user_id: members[1], amount: '5.01' },
  ]);
  assert.deepEqual(equalSplits('99999999999999.99', members, members[0]), [
    { user_id: members[0], amount: '50000000000000.00' }, { user_id: members[1], amount: '49999999999999.99' },
  ]);
});

test('custom split accepts 100/0 and validates exact sum', () => {
  assert.equal(validateCustomSplits('10.00', [{ user_id: members[0], amount: '10.00' }, { user_id: members[1], amount: '0.00' }], members), null);
  assert.match(validateCustomSplits('10.00', [{ user_id: members[0], amount: '9.99' }, { user_id: members[1], amount: '0.00' }], members) ?? '', /Faltan 0.01/);
  assert.match(validateCustomSplits('10.00', [{ user_id: members[0], amount: '10.01' }, { user_id: members[1], amount: '0.00' }], members) ?? '', /excede el total por 0.01/);
});

test('household funds never estimate interpersonal debt', () => {
  const splits = equalSplits('7.01', members, members[0]);
  assert.equal(estimatedDebtChange('household_account', splits, null), '0.00');
  assert.equal(estimatedDebtChange('personal_account', splits, members[0]), '3.50');
});
