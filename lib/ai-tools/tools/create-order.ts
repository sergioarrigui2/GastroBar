import 'server-only';

import { submitOrder } from '@/lib/services/orders';
import { submitOrderSchema } from '@/lib/validations/order';
import { defineAiTool } from '../types';

export const createOrderInput = submitOrderSchema;

export const createOrderTool = defineAiTool({
  name: 'create_order_tool',
  title: 'Crear comanda',
  description:
    'Inyecta una comanda en una mesa (table_id) o sin mesa (null, para barra/para llevar). Si la mesa ya ' +
    'tiene una orden abierta, los ítems se agregan como una nueva ronda. El precio y el enrutamiento a ' +
    'cocina/barra los decide el servidor; el stock de insumos se descuenta según receta y los KDS reciben ' +
    'la comanda al instante por Realtime. Falla con "insufficient_stock" si no hay insumos suficientes.',
  inputSchema: createOrderInput,
  allowedRoles: ['admin', 'cashier', 'waiter', 'ai_agent'],
  readOnly: false,
  async execute(input, ctx) {
    const result = await submitOrder(ctx, input);
    return {
      ...result,
      currency: ctx.tenant.currency,
      message:
        result.round > 1
          ? `Ronda ${result.round} agregada a la orden #${result.order_number}`
          : `Orden #${result.order_number} creada y enviada a cocina/barra`,
    };
  },
});
