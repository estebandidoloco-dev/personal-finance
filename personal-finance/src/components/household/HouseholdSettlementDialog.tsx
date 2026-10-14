'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { readApiError } from '@/lib/api-error';
import { compareExactMoney, normalizeMoneyInput } from '@/lib/money/exact-money';
import { isFinancialDate, todayInMexicoCity } from '@/lib/dates/financial-date';
import type { HouseholdAccount, SettlementFundingSource } from '@/lib/contracts/household';

export interface HouseholdSettlementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  householdId: string;
  maxAmount: string;
  payerName: string;
  payeeName: string;
  isPayerYou: boolean;
  accounts?: HouseholdAccount[];
  personalAccounts?: Array<{ id: string; name: string; balance?: string }>;
  onSuccess: () => void;
}

function SettlementForm({
  householdId,
  maxAmount,
  payerName,
  payeeName,
  isPayerYou,
  accounts: propAccounts,
  personalAccounts: propPersonalAccounts,
  onSuccess,
  onClose,
}: {
  householdId: string;
  maxAmount: string;
  payerName: string;
  payeeName: string;
  isPayerYou: boolean;
  accounts?: HouseholdAccount[];
  personalAccounts?: Array<{ id: string; name: string; balance?: string }>;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(maxAmount);
  const [date, setDate] = useState(todayInMexicoCity);
  const [fundingSource, setFundingSource] = useState<SettlementFundingSource>('cash');
  const [sourcePersonalAccountId, setSourcePersonalAccountId] = useState('');
  const [sourceHouseholdAccountId, setSourceHouseholdAccountId] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [personalAccounts, setPersonalAccounts] = useState<
    Array<{ id: string; name: string; balance?: string }>
  >(propPersonalAccounts ?? []);
  const [loadingPersonalAccounts, setLoadingPersonalAccounts] = useState(
    () => !propPersonalAccounts || propPersonalAccounts.length === 0
  );

  const [householdAccounts, setHouseholdAccounts] = useState<HouseholdAccount[]>(
    propAccounts ?? []
  );
  const [loadingHouseholdAccounts, setLoadingHouseholdAccounts] = useState(
    () => !propAccounts || propAccounts.length === 0
  );

  useEffect(() => {
    if (propPersonalAccounts && propPersonalAccounts.length > 0) return;
    let active = true;
    fetch('/api/accounts')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (active && Array.isArray(data)) {
          setPersonalAccounts(data);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingPersonalAccounts(false);
      });
    return () => {
      active = false;
    };
  }, [propPersonalAccounts]);

  useEffect(() => {
    if (propAccounts && propAccounts.length > 0) return;
    let active = true;
    fetch(`/api/household/accounts?household_id=${encodeURIComponent(householdId)}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (active && Array.isArray(data)) {
          setHouseholdAccounts(data);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingHouseholdAccounts(false);
      });
    return () => {
      active = false;
    };
  }, [householdId, propAccounts]);

  const activeHouseholdAccounts = householdAccounts.filter(
    (account) => account.status === 'active'
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    setError('');
    const normalized = normalizeMoneyInput(amount);
    if (!normalized || normalized === '0.00' || normalized.startsWith('-')) {
      setError('Escribe un importe mayor que 0.00 con hasta dos decimales.');
      return;
    }
    if (compareExactMoney(normalized, '0.01') < 0) {
      setError('El importe mínimo a liquidar es $0.01 MXN.');
      return;
    }
    if (compareExactMoney(normalized, maxAmount) > 0) {
      setError(`El importe no puede exceder la deuda actual ($${maxAmount} MXN).`);
      return;
    }
    if (!isFinancialDate(date)) {
      setError('Selecciona una fecha válida (AAAA-MM-DD).');
      return;
    }
    if (fundingSource === 'personal_account' && !sourcePersonalAccountId) {
      setError('Selecciona tu cuenta personal de origen.');
      return;
    }
    if (fundingSource === 'household_account' && !sourceHouseholdAccountId) {
      setError('Selecciona la cuenta de fondo común de origen.');
      return;
    }

    const trimmedNotes = notes.trim();
    if (trimmedNotes.length > 500) {
      setError('Las notas no pueden exceder 500 caracteres.');
      return;
    }

    setSubmitting(true);
    try {
      const payload: {
        household_id: string;
        amount: string;
        date: string;
        funding_source: SettlementFundingSource;
        source_personal_account_id?: string;
        source_household_account_id?: string;
        notes?: string;
        idempotency_key: string;
      } = {
        household_id: householdId,
        amount: normalized,
        date,
        funding_source: fundingSource,
        idempotency_key: crypto.randomUUID(),
      };

      if (fundingSource === 'personal_account') {
        payload.source_personal_account_id = sourcePersonalAccountId;
      } else if (fundingSource === 'household_account') {
        payload.source_household_account_id = sourceHouseholdAccountId;
      }

      if (trimmedNotes) {
        payload.notes = trimmedNotes;
      }

      const response = await fetch('/api/household/settlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const resultPayload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const apiError = readApiError(resultPayload, 'No se pudo registrar la liquidación.');
        setError(apiError.message);
        return;
      }

      window.dispatchEvent(
        new CustomEvent('household-finance-mutated', {
          detail: { householdId },
        })
      );
      onSuccess();
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'No se pudo registrar la liquidación.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="rounded-xl border border-border/60 bg-surface-subtle p-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-text-muted">Pagador:</span>
          <span className="font-semibold break-words">{payerName}</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-text-muted">Beneficiario:</span>
          <span className="font-semibold break-words">{payeeName}</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-text-muted">Deuda actual:</span>
          <span className="font-semibold tabular-nums">${maxAmount} MXN</span>
        </div>
      </div>

      <div className="rounded-xl border border-info/30 bg-info-soft/30 p-3 text-xs text-text-muted">
        <p>
          Nota: La liquidación quedará pendiente hasta que{' '}
          <strong className="text-text font-semibold">{payeeName}</strong> confirme haber recibido el dinero.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="settlement-funding-source">Origen de fondos</Label>
          <NativeSelect
            id="settlement-funding-source"
            value={fundingSource}
            onChange={(event) => {
              setFundingSource(event.target.value as SettlementFundingSource);
              setError('');
            }}
            disabled={submitting}
          >
            <option value="cash">Efectivo</option>
            <option value="personal_account" disabled={!isPayerYou}>
              Mi cuenta personal{!isPayerYou ? ' (solo pagador)' : ''}
            </option>
            <option value="household_account">Fondo común (Cuenta compartida)</option>
            <option value="in_kind">En especie</option>
          </NativeSelect>
        </div>

        {fundingSource === 'personal_account' && (
          <div className="space-y-1.5">
            <Label htmlFor="settlement-source-personal-account">Cuenta personal</Label>
            <NativeSelect
              id="settlement-source-personal-account"
              required
              value={sourcePersonalAccountId}
              onChange={(event) => setSourcePersonalAccountId(event.target.value)}
              disabled={submitting || loadingPersonalAccounts}
            >
              <option value="">Selecciona tu cuenta personal</option>
              {personalAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} {account.balance ? `($${account.balance} MXN)` : ''}
                </option>
              ))}
            </NativeSelect>
            {personalAccounts.length === 0 && !loadingPersonalAccounts && (
              <p role="alert" className="text-warning text-xs">
                No tienes cuentas personales disponibles.
              </p>
            )}
          </div>
        )}

        {fundingSource === 'household_account' && (
          <div className="space-y-1.5">
            <Label htmlFor="settlement-source-household-account">Cuenta de fondo común</Label>
            <NativeSelect
              id="settlement-source-household-account"
              required
              value={sourceHouseholdAccountId}
              onChange={(event) => setSourceHouseholdAccountId(event.target.value)}
              disabled={submitting || loadingHouseholdAccounts}
            >
              <option value="">Selecciona la cuenta común</option>
              {activeHouseholdAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} (${account.balance} MXN)
                </option>
              ))}
            </NativeSelect>
            {activeHouseholdAccounts.length === 0 && !loadingHouseholdAccounts && (
              <p role="alert" className="text-warning text-xs">
                No hay cuentas de fondo común activas en este espacio.
              </p>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="settlement-amount">Importe a liquidar (MXN)</Label>
          <Input
            id="settlement-amount"
            type="text"
            inputMode="decimal"
            required
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            disabled={submitting}
            placeholder="0.00"
            className="tabular-nums"
          />
          <p className="text-text-muted text-xs">
            Importe entre $0.01 y ${maxAmount} MXN.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="settlement-date">Fecha de pago</Label>
          <Input
            id="settlement-date"
            type="date"
            required
            value={date}
            onChange={(event) => setDate(event.target.value)}
            disabled={submitting}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="settlement-notes">Notas (opcional)</Label>
          <Input
            id="settlement-notes"
            type="text"
            maxLength={500}
            placeholder="Ej. Transferencia SPEI, Efectivo"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            disabled={submitting}
          />
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-danger bg-danger-soft p-3 text-sm text-danger"
          >
            {error}
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                <span>Confirmando…</span>
              </>
            ) : (
              'Confirmar liquidación'
            )}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

export function HouseholdSettlementDialog({
  open,
  onOpenChange,
  householdId,
  maxAmount,
  payerName,
  payeeName,
  isPayerYou,
  accounts,
  personalAccounts,
  onSuccess,
}: HouseholdSettlementDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar liquidación</DialogTitle>
          <DialogDescription>
            {isPayerYou
              ? `Registra un pago para saldar lo que debes a ${payeeName}.`
              : `Registra el pago recibido de ${payerName} para saldar la deuda.`}
          </DialogDescription>
        </DialogHeader>

        {open && (
          <SettlementForm
            key={`${householdId}:${maxAmount}`}
            householdId={householdId}
            maxAmount={maxAmount}
            payerName={payerName}
            payeeName={payeeName}
            isPayerYou={isPayerYou}
            accounts={accounts}
            personalAccounts={personalAccounts}
            onSuccess={onSuccess}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
