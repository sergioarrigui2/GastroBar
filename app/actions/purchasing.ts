'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { runAction } from '@/lib/actions';
import { assertAgent } from '@/lib/ai/entitlements';
import type { TenantContext } from '@/lib/tenant-context';
import {
  deleteSupplier,
  discardSuggestion,
  ingredientPurchaseSchema,
  receiveSchema,
  receiveSuggestion,
  reviewSuggestionWithAi,
  runPurchasePlan,
  savePurchaseSchedule,
  saveSupplier,
  scheduleSchema,
  supplierSchema,
  updateIngredientPurchasing,
} from '@/lib/services/purchasing';

const ADMIN = ['admin'] as const;

/** Todo el módulo de compras es del Comprador: exige que esté contratado. */
const withComprador =
  <T,>(fn: (ctx: TenantContext) => Promise<T>) =>
  async (ctx: TenantContext) => {
    await assertAgent(ctx, 'comprador');
    return fn(ctx);
  };
const PATH = '/admin/purchasing';

async function done<T>(result: Awaited<ReturnType<typeof runAction<T>>>) {
  if (result.ok) revalidatePath(PATH);
  return result;
}

export async function runPurchasePlanAction(input: { horizon_days: number }) {
  return done(
    await runAction(ADMIN, withComprador((ctx) =>
      runPurchasePlan(ctx.supabase, ctx.tenant.id, z.coerce.number().int().min(1).max(31).parse(input.horizon_days), 'manual'),
    )),
  );
}

export async function saveSupplierAction(input: z.input<typeof supplierSchema>) {
  return done(await runAction(ADMIN, withComprador((ctx) => saveSupplier(ctx, input))));
}

export async function deleteSupplierAction(id: string) {
  return done(await runAction(ADMIN, withComprador((ctx) => deleteSupplier(ctx, id))));
}

export async function updateIngredientPurchasingAction(input: z.input<typeof ingredientPurchaseSchema>) {
  return done(await runAction(ADMIN, withComprador((ctx) => updateIngredientPurchasing(ctx, input))));
}

export async function savePurchaseScheduleAction(input: z.input<typeof scheduleSchema>) {
  return done(await runAction(ADMIN, withComprador((ctx) => savePurchaseSchedule(ctx, input))));
}

export async function receiveSuggestionAction(input: z.input<typeof receiveSchema>) {
  const result = await runAction(ADMIN, withComprador((ctx) => receiveSuggestion(ctx, input)));
  if (result.ok) revalidatePath('/admin/inventory');
  return done(result);
}

export async function discardSuggestionAction(id: string) {
  return done(await runAction(ADMIN, withComprador((ctx) => discardSuggestion(ctx, id))));
}

export async function reviewSuggestionWithAiAction(id: string) {
  return done(await runAction(ADMIN, withComprador((ctx) => reviewSuggestionWithAi(ctx, id))));
}
