'use server';

import { revalidatePath } from 'next/cache';
import { runAction } from '@/lib/actions';
import {
  addCashMovement,
  closeCashSession,
  openCashSession,
  type cashMovementSchema,
  type closeCashSchema,
  type openCashSchema,
} from '@/lib/services/cash';
import type { z } from 'zod';

const CASH_ROLES = ['admin', 'cashier'] as const;

async function cashMutation<T>(fn: Parameters<typeof runAction<T>>[1]) {
  const result = await runAction(CASH_ROLES, fn);
  if (result.ok) revalidatePath('/cash');
  return result;
}

export async function openCashSessionAction(input: z.input<typeof openCashSchema>) {
  return cashMutation((ctx) => openCashSession(ctx, input));
}

export async function addCashMovementAction(input: z.input<typeof cashMovementSchema>) {
  return cashMutation((ctx) => addCashMovement(ctx, input));
}

export async function closeCashSessionAction(input: z.input<typeof closeCashSchema>) {
  return cashMutation((ctx) => closeCashSession(ctx, input));
}
