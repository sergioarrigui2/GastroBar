import 'server-only';

import { z } from 'zod';
import { costProduct, netOfTax } from '@/lib/catalog/costing';
import { getCatalog } from '@/lib/services/catalog';
import { formatCurrency } from '@/lib/utils';
import { defineAiTool } from '../types';

/**
 * `search` y `fetch`: los nombres y la forma de respuesta que ChatGPT espera de un
 * conector (búsqueda de documentos + lectura de uno). Aquí los "documentos" son
 * productos, insumos y categorías del gastrobar. Sólo lectura.
 */
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')).replace(/\/+$/, '');
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const searchInput = z.object({ query: z.string().trim().min(1).max(100).describe('Texto a buscar: producto, insumo o categoría') });
export const fetchInput = z.object({ id: z.string().regex(/^(product|ingredient|category):[0-9a-f-]{36}$/, 'id inválido').describe('id devuelto por search') });

export const searchTool = defineAiTool({
  name: 'search',
  title: 'Buscar en el gastrobar',
  description: 'Busca productos, insumos y categorías del gastrobar por nombre. Devuelve ids para leer el detalle con fetch.',
  inputSchema: searchInput,
  allowedRoles: ['admin', 'ai_agent'],
  readOnly: true,
  async execute(input, ctx) {
    const catalog = await getCatalog(ctx);
    const words = norm(input.query).split(/\s+/).filter(Boolean);
    const hit = (name: string) => words.every((w) => norm(name).includes(w));
    const results = [
      ...catalog.products.filter((p) => p.is_active && hit(p.name)).map((p) => ({ id: `product:${p.id}`, title: `Producto · ${p.name}`, url: `${APP_URL}/admin/menu?open=${p.id}` })),
      ...catalog.ingredients.filter((i) => hit(i.name)).map((i) => ({ id: `ingredient:${i.id}`, title: `Insumo · ${i.name}`, url: `${APP_URL}/admin/inventory` })),
      ...catalog.categories.filter((c) => hit(c.name)).map((c) => ({ id: `category:${c.id}`, title: `Categoría · ${c.name}`, url: `${APP_URL}/admin/menu?tab=categories` })),
    ].slice(0, 25);
    return { results };
  },
});

export const fetchTool = defineAiTool({
  name: 'fetch',
  title: 'Leer detalle',
  description: 'Lee el detalle de un producto (precio, costo, margen y receta), un insumo (stock, mínimo, costo y en qué productos se usa) o una categoría (sus productos).',
  inputSchema: fetchInput,
  allowedRoles: ['admin', 'ai_agent'],
  readOnly: true,
  async execute(input, ctx) {
    const [kind, id] = input.id.split(':') as ['product' | 'ingredient' | 'category', string];
    const catalog = await getCatalog(ctx);
    const money = (n: number) => formatCurrency(n, ctx.tenant.currency, ctx.tenant.locale);
    const ingredients = new Map(catalog.ingredients.map((i) => [i.id, i]));
    const subRecipes = new Map(catalog.subRecipes.map((s) => [s.id, s]));
    const categoryName = new Map(catalog.categories.map((c) => [c.id, c.name]));

    if (kind === 'product') {
      const p = catalog.products.find((x) => x.id === id);
      if (!p) throw new Error('Producto no encontrado');
      const lines = catalog.recipes.filter((r) => r.product_id === p.id);
      const net = netOfTax(p.price, p.tax_rate ?? ctx.tenant.tax_rate, ctx.tenant.prices_include_tax);
      const c = costProduct(net, lines, ingredients, subRecipes);
      const recipe = lines.map((l) => {
        const ing = l.ingredient_id ? ingredients.get(l.ingredient_id) : null;
        const sub = l.sub_recipe_id ? subRecipes.get(l.sub_recipe_id) : null;
        return `- ${l.quantity} ${ing?.unit ?? (sub ? sub.yield_unit : '')} de ${ing?.name ?? sub?.name ?? '?'}`;
      });
      const text = [
        `${p.name} (${categoryName.get(p.category_id) ?? 'sin categoría'})${p.is_active ? '' : ' · INACTIVO'}`,
        `Precio: ${money(p.price)} (sin impuesto ${money(net)})`,
        lines.length ? `Costo de receta: ${money(c.cost)} · food cost ${c.foodCostPct?.toFixed(1) ?? '—'}% · margen ${c.marginPct?.toFixed(1) ?? '—'}%` : 'Sin receta: no hay costo calculado.',
        ...(p.description ? [`Descripción: ${p.description}`] : []),
        ...(recipe.length ? ['Receta:', ...recipe] : []),
      ].join('\n');
      return { id: input.id, title: p.name, text, url: `${APP_URL}/admin/menu?open=${p.id}`, metadata: { kind } };
    }
    if (kind === 'ingredient') {
      const i = catalog.ingredients.find((x) => x.id === id);
      if (!i) throw new Error('Insumo no encontrado');
      const usedIn = catalog.recipes.filter((r) => r.ingredient_id === i.id).map((r) => catalog.products.find((p) => p.id === r.product_id)?.name).filter(Boolean);
      const text = [
        `${i.name} · unidad ${i.unit}${i.is_liquor ? ' · licor' : ''}`,
        `Stock: ${Number(i.stock_quantity)} ${i.unit} · mínimo ${Number(i.min_stock)} ${i.unit}${Number(i.min_stock) > 0 && Number(i.stock_quantity) <= Number(i.min_stock) ? ' · BAJO EL MÍNIMO' : ''}`,
        `Costo: ${money(Number(i.cost_per_unit))} por ${i.unit} · valor en bodega ${money(Math.max(0, Number(i.stock_quantity)) * Number(i.cost_per_unit))}`,
        usedIn.length ? `Se usa en ${usedIn.length} producto(s): ${usedIn.slice(0, 20).join(', ')}` : 'No se usa en ninguna receta.',
      ].join('\n');
      return { id: input.id, title: i.name, text, url: `${APP_URL}/admin/inventory`, metadata: { kind } };
    }
    const cat = catalog.categories.find((x) => x.id === id);
    if (!cat) throw new Error('Categoría no encontrada');
    const products = catalog.products.filter((p) => p.category_id === cat.id && p.is_active);
    const text = [`Categoría ${cat.name} · estación ${cat.station === 'bar' ? 'barra' : 'cocina'}`, `${products.length} producto(s) activos:`, ...products.map((p) => `- ${p.name}: ${money(p.price)}`)].join('\n');
    return { id: input.id, title: cat.name, text, url: `${APP_URL}/admin/menu?tab=categories`, metadata: { kind } };
  },
});
