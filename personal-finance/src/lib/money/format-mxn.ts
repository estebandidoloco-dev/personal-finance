import { exactMoneyToCents, isExactMoney, type ExactMoney } from './exact-money';

export function formatMxn(value: ExactMoney, locale = 'es-MX'): string {
  if (!isExactMoney(value)) return 'MXN —';
  const cents = exactMoneyToCents(value);
  const negative = cents < BigInt('0');
  const absolute = negative ? -cents : cents;
  const units = absolute / BigInt('100');
  const fraction = String(absolute % BigInt('100')).padStart(2, '0');
  let grouped: string;
  try {
    grouped = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(units);
  } catch {
    grouped = units.toString();
  }
  return `${negative ? '-' : ''}$${grouped}.${fraction} MXN`;
}
