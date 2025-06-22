import { z } from 'zod';

export const addExpenseSchema = z.object({
    amount: z.number().min(1),
    description: z.string().min(1),
    payerId: z.number().min(1),
});
