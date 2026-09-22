import { z } from 'zod';

export const paymentMethodSchema = z.enum(['cash', 'card', 'transfer', 'other']);
export const splitTypeSchema = z.enum(['full', 'by_item', 'equal', 'custom']);

const money = z.number().finite().multipleOf(0.01);

export const paymentAllocationSchema = z.object({
  order_item_id: z.uuid(),
  amount: money.positive(),
});

export const paymentInputSchema = z.object({
  amount: money.positive().describe('Monto que abona a la cuenta (sin propina)'),
  tip: money.min(0).default(0).describe('Propina asociada a este pago'),
  method: paymentMethodSchema,
  label: z.string().trim().max(60).optional().describe('Identificador del pagador, ej. "Comensal 2"'),
  reference: z.string().trim().max(120).optional().describe('Voucher, referencia de transferencia...'),
  allocations: z.array(paymentAllocationSchema).max(100).default([]),
});

export const registerPaymentsSchema = z
  .object({
    order_id: z.uuid(),
    split_type: splitTypeSchema,
    payments: z.array(paymentInputSchema).min(1).max(30),
  })
  .refine(
    (v) => v.split_type !== 'by_item' || v.payments.every((p) => p.allocations.length > 0),
    { message: 'En división por ítem cada pago debe indicar sus ítems', path: ['payments'] },
  );

export type PaymentInput = z.input<typeof paymentInputSchema>;
export type RegisterPaymentsInput = z.input<typeof registerPaymentsSchema>;
