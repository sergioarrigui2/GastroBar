import 'server-only';

import { z } from 'zod';
import { getOpenBill } from '@/lib/services/orders';
import { previewSplit, registerPayments, type SplitSpec } from '@/lib/services/payments';
import { paymentMethodSchema } from '@/lib/validations/payment';
import { defineAiTool } from '../types';

const splitSchema = z.discriminatedUnion('split_type', [
  z.object({ split_type: z.literal('full') }).describe('Una sola persona paga todo el saldo'),
  z
    .object({ split_type: z.literal('equal'), parts: z.int().min(2).max(30) })
    .describe('Saldo dividido en partes iguales'),
  z
    .object({ split_type: z.literal('custom'), amounts: z.array(z.number().positive()).min(1).max(30) })
    .describe('Montos personalizados (no pueden exceder el saldo)'),
  z
    .object({
      split_type: z.literal('by_item'),
      guests: z
        .array(
          z.object({
            label: z.string().trim().min(1).max(60),
            order_item_ids: z.array(z.uuid()).min(1),
          }),
        )
        .min(1)
        .max(30),
    })
    .describe('Cada comensal paga sus ítems; un ítem en varios comensales se reparte en partes iguales'),
]);

export const processSplitPaymentInput = z
  .object({
    table_id: z.uuid().optional().describe('Mesa cuya cuenta abierta se divide'),
    order_id: z.uuid().optional().describe('Alternativa a table_id'),
    mode: z
      .enum(['calculate', 'register'])
      .default('calculate')
      .describe('calculate = sólo simula; register = registra los pagos'),
    split: splitSchema,
    method: paymentMethodSchema.default('card').describe('Medio de pago para todas las partes'),
    methods: z
      .array(paymentMethodSchema)
      .optional()
      .describe('Medio de pago por parte (mismo orden que las partes); sobrescribe "method"'),
    tips: z.array(z.number().min(0)).optional().describe('Propina por parte (mismo orden que las partes)'),
    pay_share_indexes: z
      .array(z.int().min(0))
      .optional()
      .describe('Sólo registra estas partes (índices base 0); por defecto todas'),
  })
  .refine((v) => Boolean(v.table_id || v.order_id), { message: 'Indica table_id u order_id', path: ['table_id'] });

export const processSplitPaymentTool = defineAiTool({
  name: 'process_split_payment_tool',
  title: 'Dividir y cobrar cuenta',
  description:
    'Calcula o registra la división de pago de la cuenta abierta de una mesa: completa, partes iguales, ' +
    'montos personalizados o por ítem. Primero usa mode="calculate" para mostrar el desglose y confirma ' +
    'con el cliente; luego mode="register". Cuando el saldo llega a 0 la orden pasa a "paid" y la mesa se libera.',
  inputSchema: processSplitPaymentInput,
  allowedRoles: ['admin', 'cashier', 'waiter', 'ai_agent'],
  readOnly: false,
  async execute(input, ctx) {
    const bill = await getOpenBill(ctx, { table_id: input.table_id, order_id: input.order_id });
    if (!bill) throw new Error('No hay una cuenta abierta para esa mesa/orden');

    const preview = previewSplit(bill, input.split as SplitSpec, ctx.tenant.currency);
    const base = {
      currency: ctx.tenant.currency,
      order_number: bill.order.order_number,
      items: bill.items.map((i) => ({
        id: i.id,
        name: i.product_name,
        quantity: i.quantity,
        line_total: i.line_total,
        pending: Math.max(0, i.line_total - i.allocated),
      })),
      preview,
    };

    if (input.mode === 'calculate') return { ...base, registered: null };
    if (!preview.valid) throw new Error('La división no es válida para el saldo actual');

    const indexes = input.pay_share_indexes ?? preview.shares.map((_, i) => i);
    const payments = indexes
      .map((index) => ({ index, share: preview.shares[index] }))
      .filter((p): p is { index: number; share: NonNullable<typeof p.share> } => Boolean(p.share && p.share.amount > 0))
      .map(({ index, share }) => ({
        amount: share.amount,
        tip: input.tips?.[index] ?? 0,
        method: input.methods?.[index] ?? input.method,
        label: share.label,
        allocations: share.allocations,
      }));
    if (payments.length === 0) throw new Error('No hay partes con saldo para registrar');

    const registered = await registerPayments(ctx, {
      order_id: bill.order.id,
      split_type: input.split.split_type,
      payments,
    });
    return { ...base, registered };
  },
});
