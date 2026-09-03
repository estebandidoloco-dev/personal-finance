import { z } from 'zod';

export const dashboardPeriodSchema = z.enum(['this_month', 'previous_month', 'last_30_days']);