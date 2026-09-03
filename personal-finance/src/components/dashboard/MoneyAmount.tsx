'use client';

import { formatMoney } from '@/lib/money-format';

interface MoneyAmountProps {
  amount: number | null | undefined;
  currency: string;
  locale?: string;
}

export function MoneyAmount({ amount, currency, locale = 'es-MX' }: MoneyAmountProps) {
  return <span className="font-mono">{formatMoney(amount, currency, locale)}</span>;
}
