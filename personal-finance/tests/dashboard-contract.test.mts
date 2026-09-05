import assert from 'node:assert/strict';
import test from 'node:test';
// Node's native type-stripping loader requires the extension; the app uses bundler resolution.
// @ts-expect-error -- TypeScript disallows .ts extensions unless enabled globally.
import { dashboardResponseSchema, dateStringSchema, moneySchema, signedMoneySchema } from '../src/lib/validation/dashboard.ts';

const validId = '00000000-0000-4000-8000-000000000001';

function responseFixture() {
  return {
    period: {
      key: 'this_month',
      start_date: '2026-09-01',
      end_date_exclusive: '2026-10-01',
      timezone: 'America/Mexico_City',
    },
    currency: 'MXN',
    accounts: [{ id: validId, name: 'Cuenta', type: 'checking', balance: '-0.01' }],
    totals: {
      total_balance: '1200000000000.00',
      income: '99999999999999.99',
      expense: '0.01',
      net: '99999999999999.98',
    },
    expenses_by_category: [
      {
        category_id: null,
        name: 'Sin categoría',
        color: null,
        is_uncategorized: true,
        amount: '0.01',
      },
    ],
    time_series: {
      points: Array.from({ length: 30 }, (_, index) => ({
        date: `2026-09-${String(index + 1).padStart(2, '0')}`,
        income: '0.00',
        expense: index === 0 ? '0.01' : '0.00',
        net: index === 0 ? '-0.01' : '0.00',
      })),
    },
    recent_transactions: [
      {
        id: '00000000-0000-4000-8000-000000000002',
        date: '2026-09-01',
        description: 'Centavo',
        amount: '0.01',
        kind: 'expense',
        category: null,
        account: { id: validId, name: 'Cuenta' },
      },
    ],
  };
}

test('Money accepts exact non-negative decimal strings', () => {
  for (const value of ['0.00', '0.01', '100.00', '1200000000000.00', '99999999999999.99']) {
    assert.equal(moneySchema.safeParse(value).success, true, value);
  }
});

test('Money rejects numbers and non-canonical strings without coercion', () => {
  for (const value of [0.01, '0', '1.0', '1.000', '01.00', '+1.00', '-0.00', '-0.01', '1e10', '1,000.00']) {
    assert.equal(moneySchema.safeParse(value).success, false, String(value));
  }
});

test('SignedMoney accepts real negatives and rejects negative zero', () => {
  for (const value of ['0.00', '10.25', '-0.01', '-100.00', '99999999999999.99']) {
    assert.equal(signedMoneySchema.safeParse(value).success, true, value);
  }
  for (const value of [-0.01, '-0.00', '+1.00', '1', '1.000', '1e5', '01.00']) {
    assert.equal(signedMoneySchema.safeParse(value).success, false, String(value));
  }
});

test('DateString validates real calendar dates without UTC conversion', () => {
  for (const value of ['2026-09-05', '2024-02-29']) {
    assert.equal(dateStringSchema.safeParse(value).success, true, value);
  }
  for (const value of ['2026-02-31', '2025-02-29', '2026-13-01']) {
    assert.equal(dateStringSchema.safeParse(value).success, false, value);
  }
});

test('complete strict DashboardResponse preserves exact large money strings', () => {
  const parsed = dashboardResponseSchema.parse(responseFixture());
  assert.equal(parsed.totals.total_balance, '1200000000000.00');
  assert.equal(parsed.totals.income, '99999999999999.99');
  assert.equal(typeof parsed.totals.income, 'string');
  assert.equal(parsed.time_series.points[0]?.net, '-0.01');
});

test('strict response rejects unknown and multicurrency keys', () => {
  assert.equal(
    dashboardResponseSchema.safeParse({ ...responseFixture(), balances_by_currency: [] }).success,
    false
  );
  const fixture = responseFixture();
  assert.equal(
    dashboardResponseSchema.safeParse({
      ...fixture,
      totals: { ...fixture.totals, selected_currency: 'MXN' },
    }).success,
    false
  );
});

test('response rejects numeric money fields', () => {
  const fixture = responseFixture();
  assert.equal(
    dashboardResponseSchema.safeParse({
      ...fixture,
      totals: { ...fixture.totals, income: 1 },
    }).success,
    false
  );
});

test('time series must cover every date exactly once and in order', () => {
  const fixture = responseFixture();
  assert.equal(dashboardResponseSchema.safeParse(fixture).success, true);
  assert.equal(
    dashboardResponseSchema.safeParse({
      ...fixture,
      time_series: { points: [fixture.time_series.points[1]] },
    }).success,
    false
  );
  assert.equal(
    dashboardResponseSchema.safeParse({
      ...fixture,
      time_series: { points: [...fixture.time_series.points, fixture.time_series.points[1]] },
    }).success,
    false
  );
});

test('last_30_days rejects a shorter declared range', () => {
  const fixture = responseFixture();
  assert.equal(
    dashboardResponseSchema.safeParse({
      ...fixture,
      period: {
        ...fixture.period,
        key: 'last_30_days',
        start_date: '2026-09-01',
        end_date_exclusive: '2026-09-03',
      },
      time_series: { points: fixture.time_series.points.slice(0, 2) },
    }).success,
    false
  );
});

test('empty state permits empty entity arrays but requires the calendar', () => {
  const fixture = responseFixture();
  const empty = {
    ...fixture,
    accounts: [],
    expenses_by_category: [],
    recent_transactions: [],
    totals: { total_balance: '0.00', income: '0.00', expense: '0.00', net: '0.00' },
  };
  assert.equal(dashboardResponseSchema.safeParse(empty).success, true);
  assert.equal(
    dashboardResponseSchema.safeParse({ ...empty, time_series: { points: [] } }).success,
    false
  );
});
