import { z } from 'zod';

export const stationSchema = z.enum(['kitchen', 'bar']);
export const itemStatusSchema = z.enum(['pending', 'in_preparation', 'ready', 'delivered', 'cancelled']);

export const orderItemInputSchema = z.object({
  product_id: z.uuid().describe('ID del producto del menú'),
  quantity: z.int().min(1).max(99).default(1).describe('Unidades del producto'),
  modifier_ids: z
    .array(z.uuid())
    .max(10)
    .default([])
    .describe('IDs de modificadores aplicables (ej. "sin hielo", "término medio")'),
  notes: z.string().trim().max(280).optional().describe('Nota especial para cocina/barra'),
});

export const submitOrderSchema = z.object({
  table_id: z.uuid().nullable().describe('Mesa destino; null para pedidos de barra / para llevar'),
  items: z.array(orderItemInputSchema).min(1).max(50),
  notes: z.string().trim().max(500).optional().describe('Nota general de la comanda'),
  guests: z.int().min(1).max(50).optional().describe('Número de comensales'),
});

export const updateItemsStatusSchema = z.object({
  item_ids: z.array(z.uuid()).min(1).max(100),
  status: itemStatusSchema,
});

export const cancelOrderSchema = z.object({ order_id: z.uuid() });

export type OrderItemInput = z.input<typeof orderItemInputSchema>;
export type SubmitOrderInput = z.input<typeof submitOrderSchema>;
export type SubmitOrderData = z.output<typeof submitOrderSchema>;
export type UpdateItemsStatusInput = z.input<typeof updateItemsStatusSchema>;
