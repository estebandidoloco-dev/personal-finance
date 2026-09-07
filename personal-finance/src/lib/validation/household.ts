import { z } from 'zod';

export const householdIdSchema = z.string().uuid();
export const householdTokenSchema = z.string().regex(/^[0-9a-fA-F]{64}$/).transform((value) => value.toLowerCase());

const exactUnsignedMoney = z.string().regex(/^(0|[1-9]\d{0,11})\.\d{2}$/);
export const exactPositiveMoneySchema = exactUnsignedMoney.refine((value) => value !== '0.00', 'El importe debe ser mayor que 0.00');
export const exactNonNegativeMoneySchema = exactUnsignedMoney;
export const exactSignedMoneySchema = z
  .string()
  .regex(/^-?(0|[1-9]\d{0,11})\.\d{2}$/)
  .refine((value) => value !== '-0.00', '-0.00 no es canónico');
const aggregateUnsignedMoneyPattern = /^(0|[1-9]\d*)\.\d{2}$/;
const aggregateSignedMoneyPattern = /^-?(0|[1-9]\d*)\.\d{2}$/;
const exactAggregateUnsignedMoneySchema = z.string().regex(aggregateUnsignedMoneyPattern);
export const exactAggregateSignedMoneySchema = z
  .string()
  .regex(aggregateSignedMoneyPattern)
  .refine((value) => value !== '-0.00', '-0.00 no es canónico');

function exactMoneyToCents(value: string) {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [integer, fraction] = unsigned.split('.');
  const cents = BigInt(integer) * BigInt('100') + BigInt(fraction);
  return negative ? -cents : cents;
}

export const householdBalanceResponseSchema = z.object({
  household_id: z.string().uuid(),
  currency: z.literal('MXN'),
  positions: z.array(z.object({
    user_id: z.string().uuid(),
    amount: exactAggregateSignedMoneySchema,
  }).strict()).min(1).max(2),
  owed_by_user_id: z.string().uuid().nullable(),
  owed_to_user_id: z.string().uuid().nullable(),
  amount: exactAggregateUnsignedMoneySchema,
}).strict().superRefine((value, context) => {
  if (!aggregateUnsignedMoneyPattern.test(value.amount)
      || value.positions.some((position) => !aggregateSignedMoneyPattern.test(position.amount)
        || position.amount === '-0.00')) return;
  if (new Set(value.positions.map((position) => position.user_id)).size !== value.positions.length) {
    context.addIssue({ code: 'custom', message: 'Las posiciones deben pertenecer a usuarios distintos', path: ['positions'] });
  }
  const positions = value.positions.map((position) => ({
    userId: position.user_id,
    cents: exactMoneyToCents(position.amount),
  }));
  if (positions.reduce((total, position) => total + position.cents, BigInt('0')) !== BigInt('0')) {
    context.addIssue({ code: 'custom', message: 'Las posiciones deben sumar exactamente 0.00', path: ['positions'] });
  }
  const expectedAmount = positions.reduce((maximum, position) => {
    const absolute = position.cents < BigInt('0') ? -position.cents : position.cents;
    return absolute > maximum ? absolute : maximum;
  }, BigInt('0'));
  if (exactMoneyToCents(value.amount) !== expectedAmount) {
    context.addIssue({ code: 'custom', message: 'El importe no coincide con las posiciones', path: ['amount'] });
  }

  if (positions.length === 1) {
    if (positions[0].cents !== BigInt('0')) {
      context.addIssue({ code: 'custom', message: 'Una posición única debe ser exactamente 0.00', path: ['positions', 0, 'amount'] });
    }
    if (value.owed_by_user_id !== null) {
      context.addIssue({ code: 'custom', message: 'Un balance individual no tiene deudor', path: ['owed_by_user_id'] });
    }
    if (value.owed_to_user_id !== null) {
      context.addIssue({ code: 'custom', message: 'Un balance individual no tiene acreedor', path: ['owed_to_user_id'] });
    }
    return;
  }

  const debtor = positions.find((position) => position.cents < BigInt('0'));
  const creditor = positions.find((position) => position.cents > BigInt('0'));
  const zeroBalance = positions.every((position) => position.cents === BigInt('0'));

  if (zeroBalance) {
    if (value.owed_by_user_id !== null) {
      context.addIssue({ code: 'custom', message: 'Un balance en cero no tiene deudor', path: ['owed_by_user_id'] });
    }
    if (value.owed_to_user_id !== null) {
      context.addIssue({ code: 'custom', message: 'Un balance en cero no tiene acreedor', path: ['owed_to_user_id'] });
    }
    return;
  }

  if (debtor === undefined || creditor === undefined) {
    context.addIssue({ code: 'custom', message: 'Una deuda debe tener una posición positiva y una negativa', path: ['positions'] });
    return;
  }
  if (value.owed_by_user_id !== debtor.userId) {
    context.addIssue({ code: 'custom', message: 'El deudor debe coincidir con la posición negativa', path: ['owed_by_user_id'] });
  }
  if (value.owed_to_user_id !== creditor.userId) {
    context.addIssue({ code: 'custom', message: 'El acreedor debe coincidir con la posición positiva', path: ['owed_to_user_id'] });
  }
});

function isCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

export const financialDateSchema = z.string().refine(isCalendarDate, 'La fecha debe ser un DATE válido YYYY-MM-DD');
export const householdCursorPayloadSchema = z.object({
  version: z.literal(1),
  date: financialDateSchema,
  created_at: z.string().datetime({ offset: true }),
  id: householdIdSchema,
}).strict();
export const householdPageQuerySchema = z.object({
  household_id: householdIdSchema,
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/).optional(),
}).strict();

const accountTypeSchema = z.enum(['checking', 'savings', 'credit', 'cash', 'investment', 'other']);
const statusSchema = z.enum(['pending', 'posted', 'cancelled', 'duplicate']);
const splitSchema = z.object({
  user_id: householdIdSchema,
  amount: exactNonNegativeMoneySchema,
}).strict();
export const householdCategoryProjectionSchema = z.object({
  id: householdIdSchema,
  name: z.string().min(1),
  color: z.string().nullable(),
}).strict();

export const householdCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
}).strict();

export const householdInvitationCreateSchema = z.object({
  household_id: householdIdSchema,
  invited_email: z.string().trim().toLowerCase().email().max(320),
}).strict();
export const householdInvitationTokenBodySchema = z.object({ token: householdTokenSchema }).strict();

export const householdAccountCreateSchema = z.object({
  household_id: householdIdSchema,
  name: z.string().trim().min(1).max(100),
  type: accountTypeSchema,
  initial_balance: exactSignedMoneySchema.default('0.00'),
}).strict();
export const householdAccountUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: accountTypeSchema,
}).strict();

export const householdContributionCreateSchema = z.object({
  household_id: householdIdSchema,
  source_personal_account_id: householdIdSchema,
  destination_household_account_id: householdIdSchema,
  amount: exactPositiveMoneySchema,
  date: financialDateSchema,
  note: z.string().trim().max(2000).nullable().default(null),
  idempotency_key: householdIdSchema,
}).strict();

export const householdContributionResponseSchema = z.object({
  id: householdIdSchema,
  household_id: householdIdSchema,
  contributed_by_user_id: householdIdSchema,
  recorded_by_user_id: householdIdSchema,
  destination_household_account_id: householdIdSchema,
  amount: exactPositiveMoneySchema,
  currency: z.literal('MXN'),
  date: financialDateSchema,
  note: z.string().nullable(),
  status: z.enum(['posted', 'cancelled']),
  created_at: z.string().datetime({ offset: true }),
  cancelled_at: z.string().datetime({ offset: true }).nullable(),
}).strict().superRefine((value, context) => {
  if (value.contributed_by_user_id !== value.recorded_by_user_id) {
    context.addIssue({ code: 'custom', message: 'El contributor debe coincidir con el recorder', path: ['recorded_by_user_id'] });
  }
  if ((value.status === 'posted') !== (value.cancelled_at === null)) {
    context.addIssue({ code: 'custom', message: 'El estado no coincide con la cancelación', path: ['status'] });
  }
});

export const householdSettlementCreateSchema = z.object({
  household_id: householdIdSchema,
  amount: exactPositiveMoneySchema,
  date: financialDateSchema,
  note: z.string().trim().max(2000).nullable().default(null),
  idempotency_key: householdIdSchema,
}).strict();

export const householdSettlementResponseSchema = z.object({
  id: householdIdSchema,
  household_id: householdIdSchema,
  from_user_id: householdIdSchema,
  to_user_id: householdIdSchema,
  recorded_by_user_id: householdIdSchema,
  amount: exactPositiveMoneySchema,
  currency: z.literal('MXN'),
  date: financialDateSchema,
  note: z.string().nullable(),
  status: z.enum(['posted', 'cancelled']),
  created_at: z.string().datetime({ offset: true }),
  cancelled_at: z.string().datetime({ offset: true }).nullable(),
}).strict().superRefine((value, context) => {
  if (value.from_user_id === value.to_user_id) {
    context.addIssue({ code: 'custom', message: 'El deudor y acreedor no pueden ser el mismo usuario', path: ['to_user_id'] });
  }
  if (value.from_user_id !== value.recorded_by_user_id) {
    context.addIssue({ code: 'custom', message: 'El deudor debe coincidir con el recorder', path: ['recorded_by_user_id'] });
  }
  if ((value.status === 'posted') !== (value.cancelled_at === null)) {
    context.addIssue({ code: 'custom', message: 'El estado no coincide con la cancelación', path: ['status'] });
  }
});

export const householdIncomeCreateSchema = z.object({
  account_id: householdIdSchema,
  amount: exactPositiveMoneySchema,
  date: financialDateSchema,
  description: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).nullable().default(null),
  status: statusSchema.default('posted'),
}).strict();
export const householdIncomeUpdateSchema = householdIncomeCreateSchema.strict();

const sharedExpenseFields = {
  source_account_id: householdIdSchema,
  amount: exactPositiveMoneySchema,
  date: financialDateSchema,
  description: z.string().trim().min(1).max(200),
  split_mode: z.enum(['equal', 'custom']),
  splits: z.array(splitSchema).length(2).nullable().default(null),
  category_id: householdIdSchema.nullable().default(null),
  notes: z.string().trim().max(2000).nullable().default(null),
  status: statusSchema.default('posted'),
};

function validSplits(value: { split_mode: 'equal' | 'custom'; splits: z.infer<typeof splitSchema>[] | null }) {
  if (value.split_mode === 'equal') return value.splits === null;
  return value.splits !== null
    && new Set(value.splits.map((split) => split.user_id)).size === 2
    && value.splits.some((split) => split.amount !== '0.00');
}

export const sharedExpenseCreateSchema = z.object({
  household_id: householdIdSchema,
  funding_source: z.enum(['personal_account', 'household_account']),
  ...sharedExpenseFields,
}).strict().refine(validSplits, { message: 'Los splits no corresponden al modo seleccionado', path: ['splits'] });

export const sharedExpenseUpdateSchema = z.object(sharedExpenseFields).strict()
  .refine(validSplits, { message: 'Los splits no corresponden al modo seleccionado', path: ['splits'] });

const householdExpenseDetailBase = {
  id: householdIdSchema,
  household_id: householdIdSchema,
  recorded_by_user_id: householdIdSchema,
  split_mode: z.enum(['equal', 'custom']),
  category_id: householdIdSchema.nullable(),
  category: householdCategoryProjectionSchema.nullable(),
  amount: exactPositiveMoneySchema,
  currency: z.literal('MXN'),
  date: financialDateSchema,
  description: z.string(),
  notes: z.string().nullable(),
  status: statusSchema,
  splits: z.array(splitSchema).length(2),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
};

export const householdExpenseDetailResponseSchema = z.discriminatedUnion('funding_source', [
  z.object({
    ...householdExpenseDetailBase,
    funding_source: z.literal('personal_account'),
    source_account_id: householdIdSchema.nullable(),
    personal_payer_user_id: householdIdSchema,
  }).strict(),
  z.object({
    ...householdExpenseDetailBase,
    funding_source: z.literal('household_account'),
    source_account_id: householdIdSchema,
    personal_payer_user_id: z.null(),
  }).strict(),
]).superRefine((value, context) => {
  if ((value.category === null) !== (value.category_id === null)
      || (value.category !== null && value.category.id !== value.category_id)) {
    context.addIssue({ code: 'custom', message: 'La categoría no coincide con category_id', path: ['category'] });
  }
  if (new Set(value.splits.map((split) => split.user_id)).size !== 2) {
    context.addIssue({ code: 'custom', message: 'Los usuarios de los splits deben ser distintos', path: ['splits'] });
  }
  if (!/^(0|[1-9]\d{0,11})\.\d{2}$/.test(value.amount)
      || value.splits.some((split) => !/^(0|[1-9]\d{0,11})\.\d{2}$/.test(split.amount))) return;
  const splitTotal = value.splits.reduce(
    (total, split) => total + exactMoneyToCents(split.amount), BigInt('0'),
  );
  if (splitTotal !== exactMoneyToCents(value.amount)) {
    context.addIssue({ code: 'custom', message: 'Los splits deben sumar exactamente el importe', path: ['splits'] });
  }
});

const householdActivityBase = {
  id: householdIdSchema,
  household_expense_id: householdIdSchema.nullable(),
  personal_payer_user_id: householdIdSchema.nullable(),
  recorded_by_user_id: householdIdSchema,
  account_id: householdIdSchema.nullable(),
  amount: exactPositiveMoneySchema,
  currency: z.literal('MXN'),
  date: financialDateSchema,
  description: z.string(),
  notes: z.string().nullable(),
  status: statusSchema,
  category_id: householdIdSchema.nullable(),
  category: householdCategoryProjectionSchema.nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
};

export const householdActivityResponseSchema = z.discriminatedUnion('entry_type', [
  z.object({
    ...householdActivityBase,
    entry_type: z.literal('household_transaction'),
    household_expense_id: z.null(),
    funding_source: z.null(),
    personal_payer_user_id: z.null(),
    kind: z.enum(['income', 'expense']),
    split_mode: z.null(),
    category_id: z.null(),
    category: z.null(),
    splits: z.null(),
  }).strict(),
  z.object({
    ...householdActivityBase,
    entry_type: z.literal('shared_expense'),
    household_expense_id: householdIdSchema,
    funding_source: z.enum(['personal_account', 'household_account']),
    kind: z.literal('expense'),
    split_mode: z.enum(['equal', 'custom']),
    splits: z.array(splitSchema).length(2),
  }).strict(),
]).superRefine((value, context) => {
  if (value.entry_type !== 'shared_expense') return;
  if ((value.category === null) !== (value.category_id === null)
      || (value.category !== null && value.category.id !== value.category_id)) {
    context.addIssue({ code: 'custom', message: 'La categoría no coincide con category_id', path: ['category'] });
  }
  if (new Set(value.splits.map((split) => split.user_id)).size !== 2) {
    context.addIssue({ code: 'custom', message: 'Los usuarios de los splits deben ser distintos', path: ['splits'] });
  }
  if (!/^(0|[1-9]\d{0,11})\.\d{2}$/.test(value.amount)
      || value.splits.some((split) => !/^(0|[1-9]\d{0,11})\.\d{2}$/.test(split.amount))) return;
  const total = value.splits.reduce(
    (sum, split) => sum + exactMoneyToCents(split.amount), BigInt('0'),
  );
  if (total !== exactMoneyToCents(value.amount)) {
    context.addIssue({ code: 'custom', message: 'Los splits deben sumar exactamente el importe', path: ['splits'] });
  }
});

export const householdActivityPageResponseSchema = z.object({
  items: z.array(householdActivityResponseSchema),
  next_cursor: z.string().nullable(),
}).strict();

export const householdListQuerySchema = z.object({
  household_id: householdIdSchema,
  limit: z.coerce.number().int().min(1).max(100).default(100),
}).strict();
