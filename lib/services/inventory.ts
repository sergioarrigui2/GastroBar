import 'server-only';

import type { TenantContext } from '@/lib/tenant-context';
import { inventoryMovementSchema } from '@/lib/validations/admin';
import type { Ingredient, InventoryMovement } from '@/types/domain';
import type { z } from 'zod';

export type InventoryOverview = {
  ingredients: Ingredient[];
  movements: Array<InventoryMovement & { ingredient_name: string }>;
  waste: { last7DaysCost: number; byIngredient: Array<{ name: string; quantity: number; cost: number }> };
  stockValue: number;
  lowStockCount: number;
};

export async function getInventoryOverview(ctx: TenantContext): Promise<InventoryOverview> {
  const { supabase, tenant } = ctx;
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const [ingredientsRes, movementsRes, wasteRes] = await Promise.all([
    supabase.from('ingredients').select('*').eq('tenant_id', tenant.id).order('name'),
    supabase
      .from('inventory_movements')
      .select('*')
      .eq('tenant_id', tenant.id)
      .neq('movement_type', 'sale')
      .order('created_at', { ascending: false })
      .limit(40),
    supabase
      .from('inventory_movements')
      .select('ingredient_id, quantity, unit_cost')
      .eq('tenant_id', tenant.id)
      .eq('movement_type', 'waste')
      .gte('created_at', since),
  ]);
  if (ingredientsRes.error) throw ingredientsRes.error;
  if (movementsRes.error) throw movementsRes.error;
  if (wasteRes.error) throw wasteRes.error;

  const names = new Map(ingredientsRes.data.map((i) => [i.id, i.name]));
  const wasteByIngredient = new Map<string, { name: string; quantity: number; cost: number }>();
  for (const w of wasteRes.data) {
    const entry = wasteByIngredient.get(w.ingredient_id) ?? {
      name: names.get(w.ingredient_id) ?? '—',
      quantity: 0,
      cost: 0,
    };
    entry.quantity += Math.abs(w.quantity);
    entry.cost += Math.abs(w.quantity) * w.unit_cost;
    wasteByIngredient.set(w.ingredient_id, entry);
  }
  const byIngredient = [...wasteByIngredient.values()].sort((a, b) => b.cost - a.cost);

  return {
    ingredients: ingredientsRes.data,
    movements: movementsRes.data.map((m) => ({ ...m, ingredient_name: names.get(m.ingredient_id) ?? '—' })),
    waste: { last7DaysCost: byIngredient.reduce((s, w) => s + w.cost, 0), byIngredient },
    stockValue: ingredientsRes.data.reduce((s, i) => s + Math.max(0, i.stock_quantity) * i.cost_per_unit, 0),
    lowStockCount: ingredientsRes.data.filter((i) => i.stock_quantity <= i.min_stock).length,
  };
}

export async function recordInventoryMovement(
  ctx: TenantContext,
  input: z.input<typeof inventoryMovementSchema>,
): Promise<Ingredient> {
  const data = inventoryMovementSchema.parse(input);
  const { data: ingredient, error } = await ctx.supabase.rpc('record_inventory_movement', {
    p_ingredient_id: data.ingredient_id,
    p_type: data.type,
    p_quantity: data.quantity,
    p_reason: data.reason ?? null,
    p_unit_cost: data.unit_cost ?? null,
  });
  if (error) throw error;
  return ingredient;
}
