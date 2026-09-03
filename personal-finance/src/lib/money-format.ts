export function formatMoney(amount: number | null | undefined, currency: string, locale: string = 'es-MX'): string {
  if (amount === null || amount === undefined) return `${currency} 0.00`;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function formatMoneyNoSymbol(amount: number | null | undefined, fractionDigits: number = 2): string {
  if (amount === null || amount === undefined) return '0.00';
  try {
    return new Intl.NumberFormat('es-MX', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(amount);
  } catch {
    return amount.toFixed(fractionDigits);
  }
}
