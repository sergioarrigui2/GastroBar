import 'server-only';

import { z } from 'zod';
import { getBusinessAnalysis } from '@/lib/services/analytics';
import { defineAiTool } from '../types';

export const getBusinessAnalysisInput = z
  .object({
    from: z.iso.datetime({ offset: true }).describe('Inicio del periodo (ISO 8601)'),
    to: z.iso.datetime({ offset: true }).describe('Fin del periodo (ISO 8601)'),
  })
  .refine((v) => new Date(v.from) < new Date(v.to), { message: '"from" debe ser anterior a "to"', path: ['from'] })
  .refine((v) => new Date(v.to).getTime() - new Date(v.from).getTime() <= 366 * 86_400_000, {
    message: 'El periodo no puede superar 366 días',
    path: ['to'],
  });

export const getBusinessAnalysisTool = defineAiTool({
  name: 'get_business_analysis_tool',
  title: 'Análisis del negocio',
  description:
    'Análisis completo de un periodo contra el periodo anterior de igual duración: ventas, ticket, personas, ' +
    'food cost y margen, descuentos, cortesías, mermas y faltantes; ventas por día, día de la semana y hora; ' +
    'ingeniería de menú por producto (estrella, caballo de batalla, enigma, perro); desempeño por mesero; ' +
    'tiempos de cocina y barra; cierres de caja; consumo de insumos; y alertas detectadas por reglas estadísticas. ' +
    'Todas las cifras son exactas: úsalas tal cual, no las recalcules.',
  inputSchema: getBusinessAnalysisInput,
  allowedRoles: ['admin', 'ai_agent'],
  readOnly: true,
  async execute(input, ctx) {
    const a = await getBusinessAnalysis(ctx, { from: input.from, to: input.to });
    // Se omiten series muy largas para no inflar el contexto del agente.
    const { heatmap: _heatmap, ...snapshot } = a.snapshot;
    return { currency: ctx.tenant.currency, ...a, snapshot };
  },
});
