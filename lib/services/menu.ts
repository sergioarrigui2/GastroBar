import 'server-only';

import { withStockPolicy } from '@/lib/menu-availability';
import type { TenantContext } from '@/lib/tenant-context';
import type { Category, MenuProduct, Modifier, Station } from '@/types/domain';

export type MenuFilters = {
  category_id?: string;
  station?: Station;
  search?: string;
  only_available?: boolean;
};

export type MenuSnapshot = {
  categories: Category[];
  products: MenuProduct[];
  modifiers: Modifier[];
};

/** Menú en tiempo real con porciones disponibles calculadas desde el stock de insumos. */
export async function getMenu(ctx: TenantContext, filters: MenuFilters = {}): Promise<MenuSnapshot> {
  const { supabase, tenant } = ctx;

  let productsQuery = supabase
    .from('product_availability')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('is_active', true)
    .order('sort_order')
    .order('name');
  if (filters.category_id) productsQuery = productsQuery.eq('category_id', filters.category_id);
  if (filters.station) productsQuery = productsQuery.eq('station', filters.station);
  // Con stock negativo permitido nada se bloquea por inventario: el filtro de disponibles no aplica.
  if (filters.only_available && !tenant.allow_negative_stock) productsQuery = productsQuery.eq('is_available', true);
  if (filters.search) {
    const term = filters.search.replace(/[%_,()]/g, ' ').trim();
    if (term) productsQuery = productsQuery.ilike('name', `%${term}%`);
  }

  const [categoriesRes, productsRes, modifiersRes] = await Promise.all([
    supabase
      .from('categories')
      .select('*')
      .eq('tenant_id', tenant.id)
      .eq('is_active', true)
      .order('sort_order')
      .order('name'),
    productsQuery,
    supabase
      .from('modifiers')
      .select('*')
      .eq('tenant_id', tenant.id)
      .eq('is_active', true)
      .order('sort_order')
      .order('name'),
  ]);
  if (categoriesRes.error) throw categoriesRes.error;
  if (productsRes.error) throw productsRes.error;
  if (modifiersRes.error) throw modifiersRes.error;

  return { categories: categoriesRes.data, products: withStockPolicy(productsRes.data, tenant.allow_negative_stock), modifiers: modifiersRes.data };
}

/** Modificadores aplicables a un producto (propios, de su categoría o globales). */
export function modifiersForProduct(product: Pick<MenuProduct, 'product_id' | 'category_id'>, modifiers: Modifier[]): Modifier[] {
  return modifiers.filter(
    (m) =>
      m.product_id === product.product_id ||
      m.category_id === product.category_id ||
      (m.product_id === null && m.category_id === null),
  );
}
