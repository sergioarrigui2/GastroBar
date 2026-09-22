import 'server-only';

import { z } from 'zod';
import type { TenantContext } from '@/lib/tenant-context';
import type { PaymentMethod } from '@/types/domain';

export type CashReport = {
  from: string;
  to: string;
  opening_float: number;
  sales: number;
  tips: number;
  payments_count: number;
  orders_paid: number;
  orders_cancelled: number;
  discounts: number;
  comps: number;
  tax: number;
  voided_count: number;
  voided_amount: number;
  by_method: Partial<Record<PaymentMethod, { amount: number; tips: number; count: number }>>;
  cash_sales: number;
  cash_tips: number;
  cash_in: number;
  cash_out: number;
  expected_cash: number;
  movements: Array<{ type: 'in' | 'out'; amount: number; reason: string; at: string }>;
};

export type CashSession = {
  id: string;
  opened_at: string;
  opened_by: string | null;
  opening_float: number;
  closed_at: string | null;
  closed_by: string | null;
  counted_cash: number | null;
  expected_cash: number | null;
  difference: number | null;
  notes: string | null;
  report: CashReport;
};

export const openCashSchema = z.object({ opening_float: z.number().finite().min(0).max(1_000_000_000) });
export const cashMovementSchema = z.object({
  type: z.enum(['in', 'out']),
  amount: z.number().finite().positive().max(1_000_000_000),
  reason: z.string().trim().min(1, 'Indica el motivo').max(200),
});
export const closeCashSchema = z.object({
  counted_cash: z.number().finite().min(0).max(1_000_000_000),
  notes: z.string().trim().max(500).optional(),
});

/** Caja abierta (sin id) o una sesión concreta, con su reporte (en vivo si sigue abierta). */
export async function getCashSession(ctx: TenantContext, sessionId?: string): Promise<CashSession | null> {
  const { data, error } = await ctx.supabase.rpc('get_cash_session', { p_session_id: sessionId ?? null });
  if (error) throw error;
  return (data as unknown as CashSession | null) ?? null;
}

export async function listCashSessions(ctx: TenantContext, limit = 15) {
  const { data, error } = await ctx.supabase
    .from('cash_sessions')
    .select('id, opened_at, closed_at, opening_float, expected_cash, counted_cash, difference')
    .eq('tenant_id', ctx.tenant.id)
    .not('closed_at', 'is', null)
    .order('opened_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function openCashSession(ctx: TenantContext, input: z.input<typeof openCashSchema>) {
  const { opening_float } = openCashSchema.parse(input);
  const { error } = await ctx.supabase.rpc('open_cash_session', { p_opening_float: opening_float });
  if (error) throw error;
}

export async function addCashMovement(ctx: TenantContext, input: z.input<typeof cashMovementSchema>) {
  const data = cashMovementSchema.parse(input);
  const { error } = await ctx.supabase.rpc('add_cash_movement', {
    p_type: data.type,
    p_amount: data.amount,
    p_reason: data.reason,
  });
  if (error) throw error;
}

export async function closeCashSession(ctx: TenantContext, input: z.input<typeof closeCashSchema>): Promise<string> {
  const data = closeCashSchema.parse(input);
  const { data: closed, error } = await ctx.supabase.rpc('close_cash_session', {
    p_counted_cash: data.counted_cash,
    p_notes: data.notes ?? null,
  });
  if (error) throw error;
  return (closed as unknown as { id: string }).id;
}

/** Nombres de perfiles del tenant para mostrar quién abrió / cerró. */
export async function profileNames(ctx: TenantContext): Promise<Record<string, string>> {
  const { data, error } = await ctx.supabase.from('profiles').select('id, full_name').eq('tenant_id', ctx.tenant.id);
  if (error) throw error;
  return Object.fromEntries(data.map((p) => [p.id, p.full_name]));
}
