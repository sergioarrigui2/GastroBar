import 'server-only';

import { z } from 'zod';
import { costProduct, netOfTax } from '@/lib/catalog/costing';
import { getCatalog } from '@/lib/services/catalog';
import { defineAiTool } from '../types';

export const getMenuCostsInput = z.object({
  search: z.string().trim().max(60).optional().describe('Filtra por nombre del producto'),
  category: z.string().trim().max(60).optional().describe('Filtra por nombre de categoría'),
  include_inactive: z.boolean().default(false),
});

export const getMenuCostsTool = defineAiTool({
  name: 'get_menu_costs',
  title: 'Carta con costos y márgenes',
  description:
    'Productos de la carta con categoría, precio de venta, precio sin impuesto, costo de receta (insumos), food cost % ' +
    'y margen %. Sirve para revisar precios y rentabilidad. has_recipe = false significa que no hay costo calculado. Sólo lectura.',
  inputSchema: getMenuCostsInput,
  allowedRoles: ['admin', 'ai_agent'],
  readOnly: true,
  async execute(input, ctx) {
    const catalog = await getCatalog(ctx);
    const categories = new Map(catalog.categories.map((c) => [c.id, c.name]));
    const ingredients = new Map(catalog.ingredients.map((i) => [i.id, i]));
    const subRecipes = new Map(catalog.subRecipes.map((s) => [s.id, s]));
    const recipes = new Map<string, typeof catalog.recipes>();
    for (const r of catalog.recipes) recipes.set(r.product_id, [...(recipes.get(r.product_id) ?? []), r]);
    const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const search = input.search ? norm(input.search) : null;
    const category = input.category ? norm(input.category) : null;

    const products = catalog.products
      .filter((p) => (input.include_inactive || p.is_active) && (!search || norm(p.name).includes(search)))
      .filter((p) => !category || norm(categories.get(p.category_id) ?? '').includes(category))
      .map((p) => {
        const lines = recipes.get(p.id) ?? [];
        const net = netOfTax(p.price, p.tax_rate ?? ctx.tenant.tax_rate, ctx.tenant.prices_include_tax);
        const c = costProduct(net, lines, ingredients, subRecipes);
        return {
          name: p.name,
          category: categories.get(p.category_id) ?? null,
          price: p.price,
          net_price: Math.round(net),
          has_recipe: lines.length > 0,
          cost: lines.length ? Math.round(c.cost) : null,
          food_cost_pct: lines.length && c.foodCostPct !== null ? Math.round(c.foodCostPct * 10) / 10 : null,
          margin_pct: lines.length && c.marginPct !== null ? Math.round(c.marginPct * 10) / 10 : null,
          active: p.is_active,
        };
      });
    return { currency: ctx.tenant.currency, tax: `${ctx.tenant.tax_name} ${ctx.tenant.tax_rate}%${ctx.tenant.prices_include_tax ? ' incluido' : ''}`, products: products.slice(0, 400), truncated: products.length > 400 };
  },
});
