import { z } from 'zod';
import {
  exactSignedMoneySchema,
  householdActivityPageResponseSchema,
  householdActivityResponseSchema,
  householdBalanceResponseSchema,
  householdExpenseDetailResponseSchema,
  householdPendingSettlementSchema,
  householdSettlementResponseSchema,
  settlementFundingSourceSchema,
  settlementStatusSchema,
} from '@/lib/validation/household';

const uuid = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });

export const householdSchema = z
  .object({
    id: uuid,
    name: z.string(),
    currency: z.literal('MXN'),
    status: z.enum(['forming', 'active']),
    created_by_user_id: uuid,
    created_at: timestamp,
    activated_at: timestamp.nullable(),
    closed_at: timestamp.nullable(),
    member_count: z.number().int().min(1).max(2),
    pending_invitation: z
      .object({
        id: uuid,
        invited_email: z.string().email(),
        status: z.literal('pending'),
        expires_at: timestamp,
      })
      .nullable(),
  })
  .strict();

export const memberSchema = z
  .object({
    user_id: uuid,
    display_name: z.string().nullable(),
    avatar_url: z.string().nullable(),
    status: z.enum(['current', 'archived', 'removed']),
    joined_at: timestamp,
    ended_at: timestamp.nullable(),
  })
  .strict();

export const householdAccountSchema = z
  .object({
    id: uuid,
    household_id: uuid,
    name: z.string(),
    type: z.string(),
    initial_balance: exactSignedMoneySchema,
    balance: exactSignedMoneySchema,
    currency: z.literal('MXN'),
    status: z.enum(['active', 'closed']),
    created_by_user_id: uuid,
    created_at: timestamp,
    closed_at: timestamp.nullable(),
  })
  .passthrough();

export const splitSchema = z.object({ user_id: uuid, amount: exactSignedMoneySchema }).strict();
export const expenseDetailSchema = householdExpenseDetailResponseSchema;
export const settlementSchema = householdSettlementResponseSchema;
export const pendingSettlementSchema = householdPendingSettlementSchema;
export const balanceSchema = householdBalanceResponseSchema;
export const activitySchema = householdActivityResponseSchema;
export const pageSchema = householdActivityPageResponseSchema;
export const archivedHouseholdSchema = z
  .object({
    id: uuid,
    name: z.string(),
    status: z.literal('closed'),
    currency: z.literal('MXN'),
    created_at: timestamp,
    activated_at: timestamp.nullable(),
    closed_at: timestamp,
    members: z
      .array(z.object({ user_id: uuid, display_name: z.string().nullable() }).strict())
      .min(1)
      .max(2),
  })
  .strict();

export type Household = z.infer<typeof householdSchema>;
export type HouseholdMember = z.infer<typeof memberSchema>;
export type HouseholdAccount = z.infer<typeof householdAccountSchema>;
export type HouseholdActivity = z.infer<typeof activitySchema>;
export type HouseholdSettlement = z.infer<typeof settlementSchema>;
export type HouseholdPendingSettlement = z.infer<typeof pendingSettlementSchema>;
export type SettlementFundingSource = z.infer<typeof settlementFundingSourceSchema>;
export type SettlementStatus = z.infer<typeof settlementStatusSchema>;
export type HouseholdExpenseDetail = z.infer<typeof expenseDetailSchema>;
export type ArchivedHousehold = z.infer<typeof archivedHouseholdSchema>;
export type HouseholdBalance = z.infer<typeof balanceSchema>;
