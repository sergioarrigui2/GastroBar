import 'server-only';

import { z } from 'zod';
import { getMenu, modifiersForProduct } from '@/lib/services/menu';
import { stationSchema } from '@/lib/validations/order';
import { defineAiTool } from '../types';

export const getMenuAvailabilityInput = z.object({
  category_id: z.uuid().optional().describe('Filtra por categoría'),
  station: stationSchema.optional().describe('kitchen = comida, bar = bebidas/coctelería'),
  search: z.string().trim().max(60).optional().describe('Texto a buscar en el nombre del producto'),
  only_available: z
    .boolean()
    .default(true)
    .describe('Excluye productos sin stock suficiente de insumos para al menos una porción'),
});

export const getMenuAvailabilityTool = defineAiTool({
  name: 'get_menu_availability',
  title: 'Menú disponible',
  description:
    'Consulta el menú en tiempo real. Para cada producto devuelve precio, estación (kitchen/bar), ' +
    'porciones disponibles según el stock de insumos (null = sin control de stock), alerta de stock bajo ' +
    'y los modificadores aplicables con su costo extra. Usa los IDs devueltos para create_order_tool.',
  inputSchema: getMenuAvailabilityInput,
  allowedRoles: ['admin', 'cashier', 'waiter', 'kitchen', 'bar', 'ai_agent'],
  readOnly: true,
  async execute(input, ctx) {
    const menu = await getMenu(ctx, input);
    return {
      currency: ctx.tenant.currency,
      categories: menu.categories.map((c) => ({ id: c.id, name: c.name, station: c.station })),
      products: menu.products.map((p) => ({
        id: p.product_id,
        name: p.name,
        description: p.description,
        category_id: p.category_id,
        category: p.category_name,
        station: p.station,
        price: p.price,
        is_available: p.is_available,
        available_portions: p.available_portions,
        low_stock: p.low_stock,
        modifiers: modifiersForProduct(p, menu.modifiers).map((m) => ({
          id: m.id,
          name: m.name,
          price_delta: m.price_delta,
        })),
      })),
    };
  },
});
