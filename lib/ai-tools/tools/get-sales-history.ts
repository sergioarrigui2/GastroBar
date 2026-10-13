import 'server-only';

import { z } from 'zod';
import { getHistoryProducts, getMonthlySales, lastDaysVsLastYear } from '@/lib/services/sales-history';
import { defineAiTool } from '../types';

export const getSalesHistoryInput = z.object({
  months: z.number().int().min(1).max(36).default(13).describe('Cuántos meses hacia atrás (incluido el actual)'),
  products_month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional()
    .describe('AAAA-MM: además, los productos más vendidos de ese mes y del mismo mes del año anterior'),
});

export const getSalesHistoryTool = defineAiTool({
  name: 'get_sales_history',
  title: 'Historial de ventas',
  description:
    'Ventas por mes (total, cuentas, ticket) con la comparación contra el mismo mes del año anterior, incluyendo el ' +
    'historial importado del sistema anterior. Sirve para preguntas como «¿cómo vamos frente al año pasado?» o ' +
    '«¿qué se vendía más en diciembre?». Con products_month devuelve los productos más vendidos de ese mes. Sólo lectura.',
  inputSchema: getSalesHistoryInput,
  allowedRoles: ['admin', 'ai_agent'],
  readOnly: true,
  async execute(input, ctx) {
    const { months, today, historyUntil, days } = await getMonthlySales(ctx, input.months);
    return {
      currency: ctx.tenant.currency,
      today,
      imported_history_until: historyUntil,
      months: months.map((m) => ({
        month: m.month,
        revenue: m.revenue,
        orders: m.orders,
        avg_ticket: m.orders ? Math.round(m.revenue / m.orders) : null,
        in_progress: m.partial,
        previous_year_revenue: m.previous_year?.revenue ?? null,
        change_vs_previous_year_pct: m.change_pct,
      })),
      last_30_days_vs_last_year: lastDaysVsLastYear(days, today, 30),
      ...(input.products_month ? { products: await getHistoryProducts(ctx, input.products_month) } : {}),
    };
  },
});
