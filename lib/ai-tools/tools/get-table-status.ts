import 'server-only';

import { z } from 'zod';
import { getTableStatus } from '@/lib/services/tables';
import { defineAiTool } from '../types';

export const getTableStatusInput = z.object({
  zone_id: z.uuid().optional().describe('Filtra por zona (Terraza, Barra, Salón...)'),
  only_occupied: z.boolean().default(false).describe('Devuelve sólo mesas con comanda abierta'),
});

export const getTableStatusTool = defineAiTool({
  name: 'get_table_status',
  title: 'Estado de mesas',
  description:
    'Retorna el mapa de mesas del gastrobar: zona, capacidad, estado (free/occupied/reserved/cleaning) y, ' +
    'para cada mesa ocupada, la orden activa con total, saldo pendiente, minutos abierta y conteo de ítems ' +
    'por estado (pending, in_preparation, ready, delivered). Úsala antes de crear comandas o cobrar.',
  inputSchema: getTableStatusInput,
  allowedRoles: ['admin', 'cashier', 'waiter', 'ai_agent'],
  readOnly: true,
  async execute(input, ctx) {
    const snapshot = await getTableStatus(ctx, { zone_id: input.zone_id });
    const tables = input.only_occupied ? snapshot.tables.filter((t) => t.open_order) : snapshot.tables;
    return {
      currency: ctx.tenant.currency,
      summary: snapshot.summary,
      zones: snapshot.zones,
      tables,
    };
  },
});
