'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { runAction } from '@/lib/actions';
import { can, type Permission } from '@/lib/permissions';
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
  setSupplierActive,
  scheduleSchema,
  supplierSchema,
  updateIngredientPurchasing,
} from '@/lib/services/purchasing';

const ADMIN = ['admin'] as const;
/** El supervisor entra con el permiso que corresponda a cada operación (el administrador siempre). */
const PURCHASING = ['admin', 'supervisor'] as const;

/**
 * Todo el módulo de compras es del Comprador: exige que esté contratado. `all`: permisos que un supervisor
 * necesita JUNTOS (por ejemplo recibir mercancía exige compras e inventario).
 */
const withComprador =
  <T,>(fn: (ctx: TenantContext) => Promise<T>, all: readonly Permission[] = []) =>
  async (ctx: TenantContext) => {
    await assertAgent(ctx, 'comprador');
    for (const p of all) if (!can(ctx.profile, p)) throw new Error('No tienes permiso para esta operación. Pídeselo al administrador.');
    return fn(ctx);
  };
const PATH = '/admin/purchasing';

async function done<T>(result: Awaited<ReturnType<typeof runAction<T>>>) {
  if (result.ok) revalidatePath(PATH);
  return result;
}

export async function runPurchasePlanAction(input: { horizon_days: number }) {
  return done(
    await runAction(PURCHASING, withComprador((ctx) =>
      runPurchasePlan(ctx.supabase, ctx.tenant.id, z.coerce.number().int().min(1).max(31).parse(input.horizon_days), 'manual'),
    ), ['purchasing.use']),
  );
}

export async function saveSupplierAction(input: z.input<typeof supplierSchema>) {
  return done(await runAction(PURCHASING, withComprador((ctx) => saveSupplier(ctx, input)), ['suppliers.manage']));
}

export async function setSupplierActiveAction(id: string, isActive: boolean) {
  return done(await runAction(PURCHASING, withComprador((ctx) => setSupplierActive(ctx, id, isActive)), ['suppliers.manage']));
}

export async function deleteSupplierAction(id: string) {
  return done(await runAction(PURCHASING, withComprador((ctx) => deleteSupplier(ctx, id)), ['suppliers.manage']));
}

export async function updateIngredientPurchasingAction(input: z.input<typeof ingredientPurchaseSchema>) {
  return done(await runAction(PURCHASING, withComprador((ctx) => updateIngredientPurchasing(ctx, input)), ['purchasing.use']));
}

export async function savePurchaseScheduleAction(input: z.input<typeof scheduleSchema>) {
  return done(await runAction(ADMIN, withComprador((ctx) => savePurchaseSchedule(ctx, input))));
}

export async function receiveSuggestionAction(input: z.input<typeof receiveSchema>) {
  const result = await runAction(PURCHASING, withComprador((ctx) => receiveSuggestion(ctx, input), ['purchasing.use', 'inventory.receive']), ['purchasing.use']);
  if (result.ok) revalidatePath('/admin/inventory');
  return done(result);
}

export async function discardSuggestionAction(id: string) {
  return done(await runAction(PURCHASING, withComprador((ctx) => discardSuggestion(ctx, id)), ['purchasing.use']));
}

export async function reviewSuggestionWithAiAction(id: string) {
  return done(await runAction(ADMIN, withComprador((ctx) => reviewSuggestionWithAi(ctx, id))));
}
