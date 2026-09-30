import 'server-only';

import type { TenantContext } from '@/lib/tenant-context';
import {
  bulkTablesSchema,
  categorySchema,
  ingredientSchema,
  modifierSchema,
  productSchema,
  subRecipeSchema,
  tableSchema,
  tenantSettingsSchema,
  zoneSchema,
  type BulkTablesInput,
  type CategoryInput,
  type IngredientInput,
  type ModifierInput,
  type ProductInput,
  type SubRecipeInput,
  type TableInput,
  type TenantSettingsInput,
  type ZoneInput,
} from '@/lib/validations/catalog';
import type { Json, MeasureUnit, Tables } from '@/types/database';

export type CatalogSnapshot = {
  categories: Tables<'categories'>[];
  products: Tables<'products'>[];
  modifiers: Tables<'modifiers'>[];
  recipes: Tables<'recipes'>[];
  ingredients: Tables<'ingredients'>[];
  subRecipes: Array<Tables<'sub_recipes'> & { lines: Tables<'sub_recipe_ingredients'>[] }>;
};

/** Catálogo completo del tenant, incluidos elementos inactivos (vista de administración). */
export async function getCatalog(ctx: TenantContext): Promise<CatalogSnapshot> {
  const { supabase, tenant } = ctx;
  const [categories, products, modifiers, recipes, ingredients, subRecipes, subLines] = await Promise.all([
    supabase.from('categories').select('*').eq('tenant_id', tenant.id).order('sort_order').order('name'),
    supabase.from('products').select('*').eq('tenant_id', tenant.id).order('sort_order').order('name'),
    supabase.from('modifiers').select('*').eq('tenant_id', tenant.id).order('sort_order').order('name'),
    supabase.from('recipes').select('*').eq('tenant_id', tenant.id),
    supabase.from('ingredients').select('*').eq('tenant_id', tenant.id).order('name'),
    supabase.from('sub_recipes').select('*').eq('tenant_id', tenant.id).order('name'),
    supabase.from('sub_recipe_ingredients').select('*').eq('tenant_id', tenant.id),
  ]);
  for (const res of [categories, products, modifiers, recipes, ingredients, subRecipes, subLines]) {
    if (res.error) throw res.error;
  }

  return {
    categories: categories.data ?? [],
    products: products.data ?? [],
    modifiers: modifiers.data ?? [],
    recipes: recipes.data ?? [],
    ingredients: ingredients.data ?? [],
    subRecipes: (subRecipes.data ?? []).map((s) => ({
      ...s,
      lines: (subLines.data ?? []).filter((l) => l.sub_recipe_id === s.id),
    })),
  };
}

// ── Categorías ─────────────────────────────────────────────────────────────
export async function saveCategory(ctx: TenantContext, input: CategoryInput) {
  const { id, ...data } = categorySchema.parse(input);
  const query = id
    ? ctx.supabase.from('categories').update(data).eq('tenant_id', ctx.tenant.id).eq('id', id)
    : ctx.supabase.from('categories').insert(data);
  const { error } = await query;
  if (error) throw error;
}

// ── Productos (producto + ficha técnica en una transacción) ─────────────────
export async function saveProduct(ctx: TenantContext, input: ProductInput): Promise<string> {
  const data = productSchema.parse(input);
  const { data: productId, error } = await ctx.supabase.rpc('save_product', {
    p_id: data.id ?? null,
    p_category_id: data.category_id,
    p_name: data.name,
    p_description: data.description ?? null,
    p_price: data.price,
    p_is_active: data.is_active,
    p_track_stock: data.track_stock,
    p_sort_order: data.sort_order,
    p_tax_rate: data.tax_rate ?? null,
    p_recipe: data.recipe
      ? (data.recipe.map((l) => ({
          ingredient_id: l.ingredient_id ?? null,
          sub_recipe_id: l.sub_recipe_id ?? null,
          quantity: l.quantity,
        })) as unknown as Json)
      : null,
  });
  if (error) throw error;
  return productId;
}

/** URL pública de Supabase Storage (bucket product-images) o null para quitar la imagen. */
export async function setProductImage(ctx: TenantContext, productId: string, imageUrl: string | null) {
  if (imageUrl !== null) {
    const expectedPrefix = `/storage/v1/object/public/product-images/${ctx.tenant.id}/`;
    if (!new URL(imageUrl).pathname.startsWith(expectedPrefix)) {
      throw new Error('La imagen debe estar en la carpeta del gastrobar');
    }
  }
  const { data: before } = await ctx.supabase.from('products').select('image_url').eq('tenant_id', ctx.tenant.id).eq('id', productId).maybeSingle();
  const { error } = await ctx.supabase
    .from('products')
    .update({ image_url: imageUrl })
    .eq('tenant_id', ctx.tenant.id)
    .eq('id', productId);
  if (error) throw error;
  // La foto anterior ya no la usa nadie: se borra del almacenamiento (sólo si es de este gastrobar).
  const marker = `/storage/v1/object/public/product-images/`;
  const old = before?.image_url;
  if (old && old !== imageUrl && old.includes(`${marker}${ctx.tenant.id}/`)) {
    const path = decodeURIComponent(new URL(old).pathname.split(marker)[1] ?? '');
    const { data: stillUsed } = await ctx.supabase.from('products').select('id').eq('tenant_id', ctx.tenant.id).eq('image_url', old).limit(1);
    if (path && !stillUsed?.length) await ctx.supabase.storage.from('product-images').remove([path]);
  }
}

export async function setProductActive(ctx: TenantContext, productId: string, isActive: boolean) {
  const { error } = await ctx.supabase
    .from('products')
    .update({ is_active: isActive })
    .eq('tenant_id', ctx.tenant.id)
    .eq('id', productId);
  if (error) throw error;
}

// ── Modificadores ───────────────────────────────────────────────────────────
export async function saveModifier(ctx: TenantContext, input: ModifierInput) {
  const { id, ...rest } = modifierSchema.parse(input);
  const data = { ...rest, product_id: rest.product_id ?? null, category_id: rest.category_id ?? null };
  const query = id
    ? ctx.supabase.from('modifiers').update(data).eq('tenant_id', ctx.tenant.id).eq('id', id)
    : ctx.supabase.from('modifiers').insert(data);
  const { error } = await query;
  if (error) throw error;
}

// ── Sub-recetas ─────────────────────────────────────────────────────────────
export async function saveSubRecipe(ctx: TenantContext, input: SubRecipeInput): Promise<string> {
  const data = subRecipeSchema.parse(input);
  const { data: subId, error } = await ctx.supabase.rpc('save_sub_recipe', {
    p_id: data.id ?? null,
    p_name: data.name,
    p_yield_quantity: data.yield_quantity,
    p_yield_unit: data.yield_unit,
    p_notes: data.notes ?? null,
    p_lines: data.lines as unknown as Json,
  });
  if (error) throw error;
  return subId;
}

// ── Insumos ─────────────────────────────────────────────────────────────────
export async function saveIngredient(ctx: TenantContext, input: IngredientInput) {
  const { id, initial_stock, ...data } = ingredientSchema.parse(input);
  if (id) {
    const { error } = await ctx.supabase.from('ingredients').update(data).eq('tenant_id', ctx.tenant.id).eq('id', id);
    if (error) throw error;
    return;
  }
  const { data: created, error } = await ctx.supabase.from('ingredients').insert({ ...data, stock_quantity: 0 }).select('id').single();
  if (error) throw error;
  // El stock inicial entra como ajuste: queda en el historial y se puede rastrear o corregir.
  if (initial_stock && initial_stock > 0) {
    const { error: movementError } = await ctx.supabase.rpc('record_inventory_movement', {
      p_ingredient_id: created.id,
      p_type: 'adjustment',
      p_quantity: initial_stock,
      p_reason: 'Stock inicial',
      p_unit_cost: data.cost_per_unit,
    });
    if (movementError) throw movementError;
  }
}

// ── Zonas y mesas ───────────────────────────────────────────────────────────
export async function saveZone(ctx: TenantContext, input: ZoneInput) {
  const { id, ...data } = zoneSchema.parse(input);
  const query = id
    ? ctx.supabase.from('zones').update(data).eq('tenant_id', ctx.tenant.id).eq('id', id)
    : ctx.supabase.from('zones').insert(data);
  const { error } = await query;
  if (error) throw error;
}

export async function saveTable(ctx: TenantContext, input: TableInput) {
  const { id, ...data } = tableSchema.parse(input);
  const query = id
    ? ctx.supabase.from('tables').update(data).eq('tenant_id', ctx.tenant.id).eq('id', id)
    : ctx.supabase.from('tables').insert(data);
  const { error } = await query;
  if (error) throw error;
}

/** Crea varias mesas de una vez: prefijo + numeración (T1…T6). Omite etiquetas existentes. */
export async function createTablesBulk(ctx: TenantContext, input: BulkTablesInput): Promise<number> {
  const data = bulkTablesSchema.parse(input);
  const { data: existing, error: existingError } = await ctx.supabase
    .from('tables')
    .select('label, sort_order')
    .eq('tenant_id', ctx.tenant.id);
  if (existingError) throw existingError;

  const taken = new Set(existing.map((t) => t.label.toLowerCase()));
  const rows = Array.from({ length: data.count }, (_, i) => ({
    zone_id: data.zone_id,
    label: `${data.prefix}${data.from + i}`,
    seats: data.seats,
    sort_order: data.from + i,
  })).filter((r) => !taken.has(r.label.toLowerCase()));
  if (rows.length === 0) return 0;

  const { error } = await ctx.supabase.from('tables').insert(rows);
  if (error) throw error;
  return rows.length;
}

// ── Borrado genérico (las FKs impiden borrar lo que ya tiene historial) ─────
const DELETABLE = ['categories', 'products', 'modifiers', 'sub_recipes', 'ingredients', 'zones', 'tables'] as const;
export type DeletableEntity = (typeof DELETABLE)[number];

export function isDeletableEntity(value: string): value is DeletableEntity {
  return (DELETABLE as readonly string[]).includes(value);
}

export type IngredientUsage = {
  products: Array<{ id: string; name: string; is_active: boolean }>;
  subRecipes: Array<{ id: string; name: string }>;
};

/** Productos (receta directa) y sub-recetas que usan un insumo: lo que impide borrarlo. */
export async function getIngredientUsage(ctx: TenantContext, ingredientId: string): Promise<IngredientUsage> {
  const [recipesRes, subRes] = await Promise.all([
    ctx.supabase.from('recipes').select('product_id').eq('tenant_id', ctx.tenant.id).eq('ingredient_id', ingredientId),
    ctx.supabase.from('sub_recipe_ingredients').select('sub_recipe_id').eq('tenant_id', ctx.tenant.id).eq('ingredient_id', ingredientId),
  ]);
  if (recipesRes.error) throw recipesRes.error;
  if (subRes.error) throw subRes.error;
  const productIds = [...new Set(recipesRes.data.map((r) => r.product_id))];
  const subIds = [...new Set(subRes.data.map((r) => r.sub_recipe_id))];

  const [productsRes, subRecipesRes] = await Promise.all([
    productIds.length
      ? ctx.supabase.from('products').select('id, name, is_active').eq('tenant_id', ctx.tenant.id).in('id', productIds).order('name')
      : Promise.resolve({ data: [], error: null }),
    subIds.length
      ? ctx.supabase.from('sub_recipes').select('id, name').eq('tenant_id', ctx.tenant.id).in('id', subIds).order('name')
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (productsRes.error) throw productsRes.error;
  if (subRecipesRes.error) throw subRecipesRes.error;
  return { products: productsRes.data ?? [], subRecipes: subRecipesRes.data ?? [] };
}

/**
 * Cambia la unidad de un insumo convirtiendo stock, mínimo, costo, empaque, recetas,
 * sub-recetas e historial. factor = cuántas unidades actuales trae 1 unidad nueva.
 */
export async function changeIngredientUnit(ctx: TenantContext, ingredientId: string, unit: MeasureUnit, factor: number) {
  const { error } = await ctx.supabase.rpc('change_ingredient_unit', { p_ingredient_id: ingredientId, p_unit: unit, p_factor: factor });
  if (error) throw error;
}

export function describeUsage(usage: IngredientUsage, max = 5): string {
  const names = [...usage.products.map((p) => p.name), ...usage.subRecipes.map((s) => `${s.name} (sub-receta)`)];
  return names.slice(0, max).join(', ') + (names.length > max ? ` y ${names.length - max} más` : '');
}

export async function deleteEntity(ctx: TenantContext, entity: DeletableEntity, id: string) {
  if (entity === 'ingredients') {
    const usage = await getIngredientUsage(ctx, id);
    if (usage.products.length || usage.subRecipes.length) {
      throw new Error(`No se puede eliminar: se usa en ${describeUsage(usage)}. Quítalo primero de esas recetas.`);
    }
  }
  const { error, count } = await ctx.supabase
    .from(entity)
    .delete({ count: 'exact' })
    .eq('tenant_id', ctx.tenant.id)
    .eq('id', id);
  if (error) throw error;
  if (!count) throw new Error('No se encontró el registro o no tienes permiso para borrarlo');
}

// ── Ajustes del gastrobar ───────────────────────────────────────────────────
export async function updateTenantSettings(ctx: TenantContext, input: TenantSettingsInput) {
  const data = tenantSettingsSchema.parse(input);
  const { error } = await ctx.supabase.from('tenants').update(data).eq('id', ctx.tenant.id);
  if (error) throw error;
}
