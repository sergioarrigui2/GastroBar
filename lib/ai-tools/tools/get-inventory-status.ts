import 'server-only';

import { z } from 'zod';
import { defineAiTool } from '../types';

export const getInventoryStatusInput = z.object({
  filter: z.enum(['low', 'all', 'liquor']).default('low').describe('low = en o bajo el stock mínimo; liquor = licores; all = todos'),
  search: z.string().trim().max(60).optional().describe('Filtra por nombre del insumo'),
});

export const getInventoryStatusTool = defineAiTool({
  name: 'get_inventory_status',
  title: 'Inventario',
  description:
    'Stock actual de los insumos del gastrobar: cantidad, unidad (g, ml o unidad), stock mínimo, si está bajo, costo por unidad ' +
    'y valor en bodega. Por defecto devuelve sólo los que están en o bajo el mínimo. Sólo lectura.',
  inputSchema: getInventoryStatusInput,
  allowedRoles: ['admin', 'ai_agent'],
  readOnly: true,
  async execute(input, ctx) {
    let query = ctx.supabase
      .from('ingredients')
      .select('name, unit, stock_quantity, min_stock, cost_per_unit, is_liquor')
      .eq('tenant_id', ctx.tenant.id)
      .order('name');
    if (input.filter === 'liquor') query = query.eq('is_liquor', true);
    if (input.search) query = query.ilike('name', `%${input.search.replace(/[%_]/g, '')}%`);
    const { data, error } = await query;
    if (error) throw error;
    const all = data.map((i) => {
      const stock = Number(i.stock_quantity);
      const min = Number(i.min_stock);
      return {
        name: i.name,
        unit: i.unit,
        stock,
        min_stock: min,
        low: min > 0 && stock <= min,
        cost_per_unit: Number(i.cost_per_unit),
        stock_value: Math.round(Math.max(0, stock) * Number(i.cost_per_unit)),
        is_liquor: i.is_liquor,
      };
    });
    const items = input.filter === 'low' ? all.filter((i) => i.low) : all;
    return {
      currency: ctx.tenant.currency,
      totals: {
        ingredients: all.length,
        low_count: all.filter((i) => i.low).length,
        stock_value: all.reduce((s, i) => s + i.stock_value, 0),
      },
      items: items.slice(0, 200),
      truncated: items.length > 200,
    };
  },
});
