export type ExactMoney = string;

const EXACT_MONEY = /^-?(0|[1-9]\d*)\.\d{2}$/;

export function isExactMoney(value: unknown): value is ExactMoney {
  return typeof value === 'string' && EXACT_MONEY.test(value) && value !== '-0.00';
}

export function exactMoneyToCents(value: ExactMoney): bigint {
  if (!isExactMoney(value)) throw new Error('Importe monetario no canónico');
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [units, fraction] = unsigned.split('.');
  const cents = BigInt(units) * BigInt('100') + BigInt(fraction);
  return negative ? -cents : cents;
}

export function centsToExactMoney(cents: bigint): ExactMoney {
  const negative = cents < BigInt('0');
  const absolute = negative ? -cents : cents;
  const value = `${absolute / BigInt('100')}.${String(absolute % BigInt('100')).padStart(2, '0')}`;
  return negative ? `-${value}` : value;
}

export function addExactMoney(...values: ExactMoney[]): ExactMoney {
  return centsToExactMoney(values.reduce((total, value) => total + exactMoneyToCents(value), BigInt('0')));
}

export function subtractExactMoney(left: ExactMoney, right: ExactMoney): ExactMoney {
  return centsToExactMoney(exactMoneyToCents(left) - exactMoneyToCents(right));
}

export function compareExactMoney(left: ExactMoney, right: ExactMoney): -1 | 0 | 1 {
  const difference = exactMoneyToCents(left) - exactMoneyToCents(right);
  return difference < BigInt('0') ? -1 : difference > BigInt('0') ? 1 : 0;
}

export function absoluteExactMoney(value: ExactMoney): ExactMoney {
  const cents = exactMoneyToCents(value);
  return centsToExactMoney(cents < BigInt('0') ? -cents : cents);
}

export function normalizeMoneyInput(value: string): ExactMoney | null {
  const trimmed = value.trim();
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d{0,2}))?$/.exec(trimmed);
  if (!match) return null;
  const normalized = `${match[1]}${match[2]}.${(match[3] ?? '').padEnd(2, '0')}`;
  return isExactMoney(normalized) ? normalized : null;
}

export type SplitValue = { user_id: string; amount: ExactMoney };

export function equalSplits(total: ExactMoney, memberIds: [string, string], residualUserId: string): [SplitValue, SplitValue] {
  const cents = exactMoneyToCents(total);
  if (cents <= BigInt('0')) throw new Error('El total debe ser positivo.');
  const base = cents / BigInt('2'); const residual = cents % BigInt('2');
  return memberIds.map((userId) => ({ user_id: userId, amount: centsToExactMoney(base + (userId === residualUserId ? residual : BigInt('0'))) })) as [SplitValue, SplitValue];
}

export function validateCustomSplits(total: ExactMoney, splits: [SplitValue, SplitValue], memberIds: [string, string]): string | null {
  if (new Set(splits.map((split) => split.user_id)).size !== 2 || splits.some((split) => !memberIds.includes(split.user_id))) return 'Los miembros del reparto no son válidos.';
  let amounts: bigint[]; try { amounts = splits.map((split) => exactMoneyToCents(split.amount)); } catch { return 'Escribe importes válidos con dos decimales.'; }
  if (amounts.some((amount) => amount < BigInt('0'))) return 'Las partes no pueden ser negativas.';
  if (amounts.every((amount) => amount === BigInt('0'))) return 'Al menos una parte debe ser mayor que 0.00.';
  const difference = amounts[0] + amounts[1] - exactMoneyToCents(total);
  if (difference > BigInt('0')) return `La suma excede el total por ${centsToExactMoney(difference)}.`;
  if (difference < BigInt('0')) return `Faltan ${centsToExactMoney(-difference)} para completar el total.`;
  return null;
}

export function estimatedDebtChange(fundingSource: 'personal_account' | 'household_account', splits: [SplitValue, SplitValue], payerId: string | null) {
  if (fundingSource === 'household_account' || !payerId) return '0.00';
  return splits.find((split) => split.user_id !== payerId)?.amount ?? '0.00';
}
