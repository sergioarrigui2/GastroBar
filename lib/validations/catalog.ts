import { z } from 'zod';
import { stationSchema } from './order';

const id = z.uuid();
const optionalId = z.uuid().nullable().optional();
const name = z.string().trim().min(1, 'Nombre requerido').max(120);
const sortOrder = z.int().min(0).max(9999).default(0);
const money = z.number().finite().min(0).max(100_000_000);
const quantity = z.number().finite().positive('La cantidad debe ser mayor a 0').max(1_000_000);

export const measureUnitSchema = z.enum(['g', 'ml', 'unit']);

export const categorySchema = z.object({
  id: optionalId,
  name,
  station: stationSchema,
  sort_order: sortOrder,
  is_active: z.boolean().default(true),
});

export const recipeLineSchema = z
  .object({
    ingredient_id: optionalId,
    sub_recipe_id: optionalId,
    quantity,
  })
  .refine((l) => Boolean(l.ingredient_id) !== Boolean(l.sub_recipe_id), {
    message: 'Cada línea debe tener un insumo o una sub-receta',
  });

export const productSchema = z.object({
  id: optionalId,
  category_id: id,
  name,
  description: z.string().trim().max(500).nullable().optional(),
  price: money,
  is_active: z.boolean().default(true),
  track_stock: z.boolean().default(true),
  sort_order: sortOrder,
  recipe: z.array(recipeLineSchema).max(40).optional(),
});

export const modifierSchema = z
  .object({
    id: optionalId,
    product_id: optionalId,
    category_id: optionalId,
    name,
    price_delta: z.number().finite().min(-100_000_000).max(100_000_000).default(0),
    sort_order: sortOrder,
    is_active: z.boolean().default(true),
  })
  .refine((m) => !(m.product_id && m.category_id), { message: 'Elige producto o categoría, no ambos' });

export const subRecipeSchema = z.object({
  id: optionalId,
  name,
  yield_quantity: quantity,
  yield_unit: measureUnitSchema,
  notes: z.string().trim().max(500).nullable().optional(),
  lines: z.array(z.object({ ingredient_id: id, quantity })).max(40),
});

export const ingredientSchema = z.object({
  id: optionalId,
  name,
  unit: measureUnitSchema,
  min_stock: z.number().finite().min(0),
  cost_per_unit: z.number().finite().min(0),
  is_liquor: z.boolean().default(false),
  /** Sólo al crear: stock inicial. Después el stock cambia vía movimientos. */
  initial_stock: z.number().finite().min(0).optional(),
});

export const zoneSchema = z.object({ id: optionalId, name, sort_order: sortOrder });

export const tableSchema = z.object({
  id: optionalId,
  zone_id: id,
  label: z.string().trim().min(1).max(12),
  seats: z.int().min(1).max(50),
  sort_order: sortOrder,
});

export const bulkTablesSchema = z.object({
  zone_id: id,
  prefix: z.string().trim().max(6),
  from: z.int().min(1).max(999),
  count: z.int().min(1).max(60),
  seats: z.int().min(1).max(50),
});

export const tenantSettingsSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    currency: z.string().trim().toUpperCase().length(3),
    locale: z.string().trim().min(2).max(10),
    timezone: z.string().trim().min(3).max(64),
    kds_warning_minutes: z.int().min(1).max(240),
    kds_late_minutes: z.int().min(2).max(480),
    allow_negative_stock: z.boolean(),
    public_menu_enabled: z.boolean(),
    tax_id: z.string().trim().max(40).nullable(),
    address: z.string().trim().max(200).nullable(),
    phone: z.string().trim().max(40).nullable(),
    receipt_footer: z.string().trim().max(300).nullable(),
  })
  .refine((s) => s.kds_late_minutes > s.kds_warning_minutes, {
    message: 'El tiempo de "retrasado" debe ser mayor al de "al límite"',
    path: ['kds_late_minutes'],
  })
  .refine(
    (s) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: s.timezone });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Zona horaria inválida', path: ['timezone'] },
  );

export type CategoryInput = z.input<typeof categorySchema>;
export type ProductInput = z.input<typeof productSchema>;
export type ModifierInput = z.input<typeof modifierSchema>;
export type SubRecipeInput = z.input<typeof subRecipeSchema>;
export type IngredientInput = z.input<typeof ingredientSchema>;
export type ZoneInput = z.input<typeof zoneSchema>;
export type TableInput = z.input<typeof tableSchema>;
export type BulkTablesInput = z.input<typeof bulkTablesSchema>;
export type TenantSettingsInput = z.input<typeof tenantSettingsSchema>;
