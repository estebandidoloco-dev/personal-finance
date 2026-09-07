import { MoneyAmount } from '@/components/dashboard/MoneyAmount';
import type { HouseholdMember } from '@/lib/contracts/household';
import { memberName } from '@/lib/household/presentation';
import { estimatedDebtChange, type SplitValue } from '@/lib/household/splits';
import { subtractExactMoney, type ExactMoney } from '@/lib/money/exact-money';

export function SplitPreview({ total, splits, members, userId, fundingSource, payerId }: {
  total: ExactMoney; splits: [SplitValue, SplitValue]; members: HouseholdMember[]; userId: string;
  fundingSource: 'personal_account' | 'household_account'; payerId: string | null;
}) {
  const mine = splits.find((split) => split.user_id === userId)?.amount ?? '0.00';
  const partner = splits.find((split) => split.user_id !== userId)?.amount ?? '0.00';
  const difference = subtractExactMoney(mine, partner);
  return <section aria-label="Vista previa del reparto" className="rounded-xl bg-surface-subtle p-4">
    <h3 className="font-semibold">Vista previa</h3>
    <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
      <div><dt className="text-text-muted">Total</dt><dd><MoneyAmount amount={total} /></dd></div>
      {splits.map((split) => <div key={split.user_id}><dt className="text-text-muted">{memberName(members.find((member) => member.user_id === split.user_id), userId)}</dt><dd><MoneyAmount amount={split.amount} /></dd></div>)}
      <div><dt className="text-text-muted">Diferencia entre partes</dt><dd><MoneyAmount amount={difference} /></dd></div>
      <div><dt className="text-text-muted">Cambio estimado de deuda</dt><dd><MoneyAmount amount={estimatedDebtChange(fundingSource, splits, payerId)} /></dd></div>
    </dl>
    {fundingSource === 'household_account' && <p className="mt-3 text-xs text-text-muted">Los fondos comunes no generan deuda entre ustedes.</p>}
    <span className="sr-only">Tu parte es {mine}; la parte de tu pareja es {partner}.</span>
  </section>;
}
