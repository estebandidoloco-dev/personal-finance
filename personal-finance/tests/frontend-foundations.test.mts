import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error Node type stripping requires source extensions.
import { addExactMoney, centsToExactMoney, compareExactMoney, exactMoneyToCents, isExactMoney, normalizeMoneyInput, subtractExactMoney } from '../src/lib/money/exact-money.ts';
// @ts-expect-error Node type stripping requires source extensions.
import { formatFinancialDate, isFinancialDate } from '../src/lib/dates/financial-date.ts';

test('exact money remains exact beyond safe cents', () => {
  for (const value of ['1200000000000.00', '99999999999999.99', '-0.01']) {
    assert.equal(centsToExactMoney(exactMoneyToCents(value)), value);
  }
  assert.equal(addExactMoney('99999999999999.99', '0.01'), '100000000000000.00');
  assert.equal(subtractExactMoney('0.00', '0.01'), '-0.01');
  assert.equal(compareExactMoney('2.00', '10.00'), -1);
});

test('money input and formatting stay canonical', () => {
  assert.equal(normalizeMoneyInput('1'), '1.00');
  assert.equal(normalizeMoneyInput('1.2'), '1.20');
  assert.equal(normalizeMoneyInput('-0'), null);
  assert.equal(isExactMoney('-0.00'), false);
});

test('financial dates are calendar-only', () => {
  assert.equal(isFinancialDate('2028-02-29'), true);
  assert.equal(isFinancialDate('2026-02-29'), false);
  assert.equal(formatFinancialDate('2026-09-05'), '05/09/2026');
});
