'use server';

import { FLOOR_ROLES, runAction } from '@/lib/actions';
import { registerPayments, voidPayment } from '@/lib/services/payments';
import type { RegisterPaymentsInput } from '@/lib/validations/payment';

export async function registerPaymentsAction(input: RegisterPaymentsInput) {
  return runAction(FLOOR_ROLES, (ctx) => registerPayments(ctx, input));
}

export async function voidPaymentAction(input: { payment_id: string; reason: string }) {
  return runAction(['admin'], (ctx) => voidPayment(ctx, input));
}
