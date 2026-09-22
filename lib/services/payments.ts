import 'server-only';

import {
  buildEqualShares,
  checkCustomSplit,
  currencyDecimals,
  remainingBalance,
  splitByItems,
  type SplitShare,
} from '@/lib/billing/split-bill';
import type { TenantContext } from '@/lib/tenant-context';
import { registerPaymentsSchema, type RegisterPaymentsInput } from '@/lib/validations/payment';
import type { Json } from '@/types/database';
import type { RegisterPaymentsResult, SplitType, TableBill } from '@/types/domain';

/** Registra uno o varios pagos de forma atómica (RPC register_payments). */
export async function registerPayments(
  ctx: TenantContext,
  input: RegisterPaymentsInput,
): Promise<RegisterPaymentsResult> {
  const data = registerPaymentsSchema.parse(input);
  const { data: result, error } = await ctx.supabase.rpc('register_payments', {
    p_order_id: data.order_id,
    p_split_type: data.split_type,
    p_payments: data.payments as unknown as Json,
  });
  if (error) throw error;
  return result as unknown as RegisterPaymentsResult;
}

export type SplitSpec =
  | { split_type: 'full' }
  | { split_type: 'equal'; parts: number }
  | { split_type: 'custom'; amounts: number[] }
  | { split_type: 'by_item'; guests: Array<{ label: string; order_item_ids: string[] }> };

export type SplitPreview = {
  order_id: string;
  split_type: SplitType;
  total: number;
  paid_amount: number;
  remaining: number;
  shares: SplitShare[];
  /** by_item: saldo de ítems no asignados; custom: saldo no cubierto. */
  unassigned: number;
  valid: boolean;
};

/** Calcula (sin registrar) cómo quedaría la división de la cuenta. */
export function previewSplit(bill: TableBill, spec: SplitSpec, currency: string): SplitPreview {
  const decimals = currencyDecimals(currency);
  const remaining = remainingBalance(bill.order.total, bill.order.paid_amount, decimals);
  const base = {
    order_id: bill.order.id,
    split_type: spec.split_type,
    total: bill.order.total,
    paid_amount: bill.order.paid_amount,
    remaining,
  };

  switch (spec.split_type) {
    case 'full':
      return {
        ...base,
        shares: [{ label: 'Cuenta completa', amount: remaining, allocations: [] }],
        unassigned: 0,
        valid: remaining > 0,
      };
    case 'equal':
      return {
        ...base,
        shares: buildEqualShares(remaining, spec.parts, decimals),
        unassigned: 0,
        valid: remaining > 0,
      };
    case 'custom': {
      const check = checkCustomSplit(spec.amounts, remaining, decimals);
      return {
        ...base,
        shares: spec.amounts.map((amount, i) => ({ label: `Pago ${i + 1}`, amount, allocations: [] })),
        unassigned: Math.max(0, check.difference),
        valid: check.valid,
      };
    }
    case 'by_item': {
      const assignments: Record<string, number[]> = {};
      spec.guests.forEach((guest, index) => {
        for (const itemId of guest.order_item_ids) (assignments[itemId] ??= []).push(index);
      });
      const lines = bill.items.map((i) => ({
        id: i.id,
        name: i.product_name,
        lineTotal: i.line_total,
        allocated: i.allocated,
      }));
      const unknownIds = Object.keys(assignments).filter((id) => !lines.some((l) => l.id === id));
      const result = splitByItems(lines, assignments, spec.guests.map((g) => g.label), decimals);
      return {
        ...base,
        shares: result.shares,
        unassigned: result.unassigned,
        valid: unknownIds.length === 0 && result.shares.some((s) => s.amount > 0),
      };
    }
  }
}
