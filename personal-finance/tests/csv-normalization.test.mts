import assert from 'node:assert/strict';
import test from 'node:test';
// Node's native type-stripping loader requires the explicit extension; the app build uses bundler resolution.
// @ts-expect-error -- TypeScript disallows .ts extensions unless allowImportingTsExtensions is global.
import { normalizeCsvAmount, normalizeCsvDate, normalizeCsvRow } from '../src/lib/csv/normalization.ts';

const row = (amount: string) => ({ row_number: 2, date: '2026-09-01', description: 'Café', amount });

test('normaliza formatos MXN y europeos sin perder centavos', () => {
  assert.deepEqual(normalizeCsvAmount(row('$1,234.56'), 'signed', 'auto'), { amount: '1234.56', kind: 'income' });
  assert.deepEqual(normalizeCsvAmount(row('-$1,234.56'), 'signed', 'auto'), { amount: '1234.56', kind: 'expense' });
  assert.deepEqual(normalizeCsvAmount(row('(1,234.56)'), 'signed', 'auto'), { amount: '1234.56', kind: 'expense' });
  assert.deepEqual(normalizeCsvAmount(row('1.234,56'), 'signed', 'auto'), { amount: '1234.56', kind: 'income' });
  assert.deepEqual(normalizeCsvAmount(row('1234,56'), 'signed', 'auto'), { amount: '1234.56', kind: 'income' });
});

test('1,234 y 1.234 son ambiguos en automático', () => {
  assert.throws(() => normalizeCsvAmount(row('1,234'), 'signed', 'auto'), /ambiguo/);
  assert.throws(() => normalizeCsvAmount(row('1.234'), 'signed', 'auto'), /ambiguo/);
  assert.equal(normalizeCsvAmount(row('1,234'), 'signed', 'decimal_dot').amount, '1234.00');
  assert.equal(normalizeCsvAmount(row('1.234'), 'signed', 'decimal_comma').amount, '1234.00');
  assert.throws(() => normalizeCsvAmount(row('1,23,4.56'), 'signed', 'auto'), /agrupación/);
});

test('normaliza débito/crédito e importe más tipo', () => {
  assert.deepEqual(
    normalizeCsvAmount({ ...row(''), debit: '200.00', credit: '' }, 'debit_credit', 'decimal_dot'),
    { amount: '200.00', kind: 'expense' }
  );
  assert.deepEqual(
    normalizeCsvAmount({ ...row('50.00'), type: 'abono' }, 'amount_type', 'decimal_dot'),
    { amount: '50.00', kind: 'income' }
  );
});

test('fechas bancarias no pasan por UTC', () => {
  assert.equal(normalizeCsvDate('2026-09-01', 'iso'), '2026-09-01');
  assert.equal(normalizeCsvDate('01/09/2026', 'dmy'), '2026-09-01');
  assert.equal(normalizeCsvDate('09/01/2026', 'mdy'), '2026-09-01');
  assert.throws(() => normalizeCsvDate('31/02/2026', 'dmy'), /no existe/);
});

test('una fila vacía y una fecha inválida se reportan como inválidas', () => {
  assert.equal(normalizeCsvRow({ row_number: 2, date: '', description: '', amount: '' }, {
    amount_mode: 'signed', date_format: 'iso', number_format: 'auto',
  }).ok, false);
  assert.equal(normalizeCsvRow({ ...row('10.00'), date: '2026-02-31' }, {
    amount_mode: 'signed', date_format: 'iso', number_format: 'auto',
  }).ok, false);
});
