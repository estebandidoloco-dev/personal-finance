import { formatMxn } from '@/lib/money/format-mxn';

export function MoneyAmount({ amount, className = '', sign }: { amount: string; className?: string; sign?: 'positive' | 'negative' }) {
  const prefix = sign === 'positive' && !amount.startsWith('-') ? '+' : sign === 'negative' && amount !== '0.00' ? '−' : '';
  return <span className={`break-words tabular-nums ${className}`}>{prefix}{formatMxn(amount)}</span>;
}
