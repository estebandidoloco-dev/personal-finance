'use client';

import { useState } from 'react';
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
import { readApiError } from '@/lib/api-error';
import { compareExactMoney, normalizeMoneyInput } from '@/lib/money/exact-money';
import { isFinancialDate, todayInMexicoCity } from '@/lib/dates/financial-date';

export interface HouseholdSettlementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  householdId: string;
  maxAmount: string;
  payerName: string;
  payeeName: string;
  isPayerYou: boolean;
  onSuccess: () => void;
}

function SettlementForm({
  householdId,
  maxAmount,
  payerName,
  payeeName,
  onSuccess,
  onClose,
}: {
  householdId: string;
  maxAmount: string;
  payerName: string;
  payeeName: string;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(maxAmount);
  const [date, setDate] = useState(todayInMexicoCity);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

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

    const trimmedNotes = notes.trim();
    if (trimmedNotes.length > 500) {
      setError('Las notas no pueden exceder 500 caracteres.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/household/settlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          household_id: householdId,
          amount: normalized,
          date,
          notes: trimmedNotes || undefined,
          idempotency_key: crypto.randomUUID(),
        }),
      });

      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const apiError = readApiError(payload, 'No se pudo registrar la liquidación.');
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

      <form onSubmit={handleSubmit} className="space-y-4">
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
            onSuccess={onSuccess}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
