'use client';

import { useMemo } from 'react';
import type { HouseholdMember } from '@/lib/contracts/household';
import { memberName } from '@/lib/household/presentation';
import { equalSplits, validateCustomSplits, type SplitValue } from '@/lib/household/splits';
import { normalizeMoneyInput, type ExactMoney } from '@/lib/money/exact-money';
import { SplitPreview } from './SplitPreview';

export type SplitMode = 'equal' | 'custom';

export function SplitEditor({ total, mode, customSplits, members, userId, fundingSource, residualUserId, disabled = false, onModeChange, onCustomChange }: {
  total: ExactMoney | null; mode: SplitMode; customSplits: [SplitValue, SplitValue]; members: HouseholdMember[];
  userId: string; fundingSource: 'personal_account' | 'household_account'; residualUserId: string; disabled?: boolean;
  onModeChange: (mode: SplitMode) => void; onCustomChange: (splits: [SplitValue, SplitValue]) => void;
}) {
  const memberIds = members.map((member) => member.user_id) as [string, string];
  const preview = useMemo(() => {
    if (!total || memberIds.length !== 2) return null;
    return mode === 'equal' ? equalSplits(total, memberIds, residualUserId) : customSplits;
  }, [customSplits, memberIds, mode, residualUserId, total]);
  const error = total && mode === 'custom' && memberIds.length === 2 ? validateCustomSplits(total, customSplits, memberIds) : null;
  return <fieldset disabled={disabled} className="space-y-4">
    <legend className="text-sm font-semibold">Reparto</legend>
    <div className="mt-2 grid grid-cols-2 rounded-xl bg-surface-subtle p-1">
      {(['equal', 'custom'] as const).map((value) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => onModeChange(value)} className={`min-h-11 rounded-lg px-3 text-sm font-semibold ${mode === value ? 'bg-surface-raised text-primary shadow-sm' : 'text-text-muted'}`}>{value === 'equal' ? '50/50' : 'Personalizado'}</button>)}
    </div>
    {mode === 'custom' && <div className="grid gap-3 sm:grid-cols-2">{members.map((member, index) => <label key={member.user_id} className="text-sm font-medium">Parte de {memberName(member, userId)}
      <input inputMode="decimal" aria-invalid={Boolean(error)} value={customSplits[index]?.amount ?? ''} onChange={(event) => {
        const next = [...customSplits] as [SplitValue, SplitValue];
        next[index] = { user_id: member.user_id, amount: event.target.value };
        onCustomChange(next);
      }} className="mt-1 w-full bg-surface px-3 tabular-nums" />
    </label>)}</div>}
    {mode === 'custom' && customSplits.some((split) => normalizeMoneyInput(split.amount) === null) && <p role="alert" className="text-sm text-danger">Usa importes con hasta dos decimales.</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {preview && total && !error && <SplitPreview total={total} splits={preview} members={members} userId={userId} fundingSource={fundingSource} payerId={fundingSource === 'personal_account' ? residualUserId : null} />}
  </fieldset>;
}
