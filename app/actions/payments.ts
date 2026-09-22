'use server';

import { FLOOR_ROLES, runAction } from '@/lib/actions';
import { registerPayments } from '@/lib/services/payments';
import type { RegisterPaymentsInput } from '@/lib/validations/payment';

export async function registerPaymentsAction(input: RegisterPaymentsInput) {
  return runAction(FLOOR_ROLES, (ctx) => registerPayments(ctx, input));
}
