import { ZodError } from 'zod';
import { archivedHouseholdSchema, memberSchema } from '@/lib/contracts/household';
import { householdBalanceResponseSchema } from '@/lib/validation/household';

const archivedMembersSchema = memberSchema.array().min(1).max(2);

export function parseArchivedHouseholdResources(payloads: {
  archive: unknown;
  members: unknown;
  balance: unknown;
}) {
  try {
    return {
      archive: archivedHouseholdSchema.parse(payloads.archive),
      members: archivedMembersSchema.parse(payloads.members),
      balance: householdBalanceResponseSchema.parse(payloads.balance),
    };
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error('La información de este espacio anterior no tiene el formato esperado.');
    }
    throw error;
  }
}
