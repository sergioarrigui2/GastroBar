import 'server-only';
import type { TenantContext } from '@/lib/tenant-context';

export type SetupStepId = 'settings' | 'floor' | 'ingredients' | 'menu' | 'staff' | 'first_sale';

export type SetupStatus = {
  steps: Record<SetupStepId, boolean>;
  done: number;
  total: number;
  complete: boolean;
};

/** Estado de la puesta en marcha, deducido de los datos reales del gastrobar. */
export async function getSetupStatus(ctx: TenantContext): Promise<SetupStatus> {
  const { supabase, tenant } = ctx;
  const count = async (table: 'tables' | 'ingredients' | 'products' | 'recipes' | 'profiles') => {
    const { count: n, error } = await supabase.from(table).select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id);
    if (error) throw error;
    return n ?? 0;
  };

  const [tables, ingredients, products, recipes, staff, paid] = await Promise.all([
    count('tables'),
    count('ingredients'),
    count('products'),
    count('recipes'),
    count('profiles'),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id)
      .eq('status', 'paid')
      .then(({ count: n, error }) => {
        if (error) throw error;
        return n ?? 0;
      }),
  ]);

  const steps: Record<SetupStepId, boolean> = {
    settings: Boolean(tenant.tax_id || tenant.address || tenant.phone),
    floor: tables > 0,
    ingredients: ingredients > 0,
    menu: products > 0 && recipes > 0,
    staff: staff > 1,
    first_sale: paid > 0,
  };
  const done = Object.values(steps).filter(Boolean).length;
  const total = Object.keys(steps).length;
  return { steps, done, total, complete: done === total };
}
