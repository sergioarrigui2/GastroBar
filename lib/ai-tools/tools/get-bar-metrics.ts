import 'server-only';

import { z } from 'zod';
import { getShiftMetrics } from '@/lib/services/metrics';
import { defineAiTool } from '../types';

export const getBarMetricsInput = z
  .object({
    from: z.iso.datetime({ offset: true }).optional().describe('Inicio (ISO 8601). Por defecto: inicio del turno (06:00 local)'),
    to: z.iso.datetime({ offset: true }).optional().describe('Fin (ISO 8601). Por defecto: ahora'),
  })
  .refine((v) => !v.from || !v.to || new Date(v.from) < new Date(v.to), {
    message: '"from" debe ser anterior a "to"',
    path: ['from'],
  });

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export const getBarMetricsTool = defineAiTool({
  name: 'get_bar_metrics_tool',
  title: 'Métricas del turno',
  description:
    'Métricas consolidadas del turno para consultas ejecutivas: ventas, propinas, ticket promedio, órdenes ' +
    'cerradas y abiertas, ocupación, costo de insumos consumidos (según recetas), costo de mermas, margen ' +
    'bruto, ventas por estación y medio de pago, tiempos de preparación y productos más vendidos.',
  inputSchema: getBarMetricsInput,
  allowedRoles: ['admin', 'cashier', 'ai_agent'],
  readOnly: true,
  async execute(input, ctx) {
    const m = await getShiftMetrics(ctx, { from: input.from, to: input.to });
    const salesTotal = Object.values(m.sales_by_station).reduce((a, b) => a + (b ?? 0), 0);
    return {
      currency: ctx.tenant.currency,
      period: { from: m.from, to: m.to, timezone: ctx.tenant.timezone },
      ...m,
      derived: {
        gross_margin_pct: m.revenue > 0 ? round(((m.revenue - m.ingredient_cost) / m.revenue) * 100) : null,
        food_cost_pct: m.revenue > 0 ? round((m.ingredient_cost / m.revenue) * 100) : null,
        waste_pct_of_cost: m.ingredient_cost > 0 ? round((m.waste_cost / m.ingredient_cost) * 100) : null,
        occupancy_pct: m.total_tables > 0 ? round((m.occupied_tables / m.total_tables) * 100) : null,
        bar_share_pct: salesTotal > 0 ? round(((m.sales_by_station.bar ?? 0) / salesTotal) * 100) : null,
        tip_pct: m.revenue > 0 ? round((m.tips / m.revenue) * 100) : null,
      },
    };
  },
});
