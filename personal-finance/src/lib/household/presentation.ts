import type { HouseholdMember } from '@/lib/contracts/household';

export function memberName(
  member: Pick<HouseholdMember, 'display_name' | 'user_id'> | undefined,
  currentUserId?: string
) {
  if (!member) return 'la otra persona';
  if (currentUserId && member.user_id === currentUserId) return 'Tú';
  return member.display_name?.trim() || 'Tu pareja';
}

export function accountTypeLabel(type: string) {
  return (
    (
      {
        checking: 'Cuenta corriente',
        savings: 'Ahorro',
        credit: 'Crédito',
        cash: 'Efectivo',
        investment: 'Inversión',
        other: 'Otra',
      } as Record<string, string>
    )[type] ?? type
  );
}

export function householdStatusLabel(status: string) {
  return (
    (
      { forming: 'Esperando pareja', active: 'Activo', closed: 'Espacio cerrado' } as Record<
        string,
        string
      >
    )[status] ?? status
  );
}

export function transactionStatusLabel(status: string) {
  return (
    (
      {
        posted: 'Confirmado',
        pending: 'Pendiente',
        cancelled: 'Cancelado',
        duplicate: 'Duplicado',
      } as Record<string, string>
    )[status] ?? status
  );
}

export function getExpenseCategoryLabel(expense: { category?: { name: string } | null }) {
  return expense.category?.name ?? 'Sin categoría';
}

export function archivedBalancePresentation(
  memberCount: number,
  balance: { amount: string; owed_by_user_id: string | null },
  currentUserId: string,
  otherName: string
) {
  if (memberCount === 1) {
    return {
      label: null,
      title: 'Sin balance pendiente',
      amount: null,
      helper: 'Este espacio se cerró antes de que la otra persona se uniera.',
    };
  }

  return {
    label: 'Balance entre ustedes · histórico',
    title:
      !balance.owed_by_user_id || balance.amount === '0.00'
        ? 'Quedaron a mano'
        : balance.owed_by_user_id === currentUserId
          ? `Debías a ${otherName}`
          : `${otherName} te debía`,
    amount: balance.amount,
    helper: 'Este balance no es un saldo bancario. Refleja gastos personales adelantados.',
  };
}
