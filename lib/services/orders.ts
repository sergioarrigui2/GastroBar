import 'server-only';

import type { TenantContext } from '@/lib/tenant-context';
import {
  submitOrderSchema,
  updateItemsStatusSchema,
  type SubmitOrderInput,
  type UpdateItemsStatusInput,
} from '@/lib/validations/order';
import type { Json } from '@/types/database';
import type { KdsTicket, Station, SubmitOrderResult, TableBill } from '@/types/domain';
import { OPEN_ORDER_STATUSES } from './tables';

/**
 * Crea la comanda de la mesa (o agrega una ronda a la abierta). Precio, estación
 * y modificadores los resuelve la base de datos; el INSERT dispara el descuento
 * de stock y el evento Realtime que reciben los KDS de barra/cocina.
 */
export async function submitOrder(ctx: TenantContext, input: SubmitOrderInput): Promise<SubmitOrderResult> {
  const data = submitOrderSchema.parse(input);
  const { data: result, error } = await ctx.supabase.rpc('submit_order', {
    p_table_id: data.table_id,
    p_items: data.items as unknown as Json,
    p_notes: data.notes ?? null,
    p_guests: data.guests ?? null,
  });
  if (error) throw error;
  return result as unknown as SubmitOrderResult;
}

export async function updateItemsStatus(ctx: TenantContext, input: UpdateItemsStatusInput): Promise<number> {
  const data = updateItemsStatusSchema.parse(input);
  const { data: rows, error } = await ctx.supabase
    .from('order_items')
    .update({ status: data.status })
    .eq('tenant_id', ctx.tenant.id)
    .in('id', data.item_ids)
    .select('id');
  if (error) throw error;
  return rows.length;
}

export async function cancelOrder(ctx: TenantContext, orderId: string): Promise<void> {
  const { error } = await ctx.supabase
    .from('orders')
    .update({ status: 'cancelled' })
    .eq('tenant_id', ctx.tenant.id)
    .eq('id', orderId);
  if (error) throw error;
}

/** Cuenta abierta de una mesa (o de una orden concreta) con ítems, asignaciones y pagos. */
export async function getOpenBill(
  ctx: TenantContext,
  ref: { table_id?: string; order_id?: string },
): Promise<TableBill | null> {
  const { supabase, tenant } = ctx;

  let orderQuery = supabase.from('orders').select('*').eq('tenant_id', tenant.id);
  if (ref.order_id) orderQuery = orderQuery.eq('id', ref.order_id);
  else if (ref.table_id) orderQuery = orderQuery.eq('table_id', ref.table_id).in('status', OPEN_ORDER_STATUSES);
  else throw new Error('Se requiere table_id u order_id');

  const { data: order, error: orderError } = await orderQuery.maybeSingle();
  if (orderError) throw orderError;
  if (!order) return null;

  const [itemsRes, paymentsRes] = await Promise.all([
    supabase
      .from('order_items')
      .select('*')
      .eq('tenant_id', tenant.id)
      .eq('order_id', order.id)
      .neq('status', 'cancelled')
      .order('round')
      .order('created_at'),
    supabase
      .from('payments')
      .select('*')
      .eq('tenant_id', tenant.id)
      .eq('order_id', order.id)
      .order('created_at'),
  ]);
  if (itemsRes.error) throw itemsRes.error;
  if (paymentsRes.error) throw paymentsRes.error;

  const paymentIds = paymentsRes.data.map((p) => p.id);
  const allocationsRes = paymentIds.length
    ? await supabase
        .from('payment_allocations')
        .select('order_item_id, amount')
        .eq('tenant_id', tenant.id)
        .in('payment_id', paymentIds)
    : { data: [] as Array<{ order_item_id: string; amount: number }>, error: null };
  if (allocationsRes.error) throw allocationsRes.error;

  const allocatedByItem = new Map<string, number>();
  for (const a of allocationsRes.data) {
    allocatedByItem.set(a.order_item_id, (allocatedByItem.get(a.order_item_id) ?? 0) + a.amount);
  }

  return {
    order,
    items: itemsRes.data.map((item) => ({ ...item, allocated: allocatedByItem.get(item.id) ?? 0 })),
    payments: paymentsRes.data,
  };
}

/** Ventana de búsqueda del KDS: comandas más antiguas se consideran abandonadas. */
const KDS_WINDOW_HOURS = 12;

/**
 * Tickets vivos de una estación. Un ticket = una ronda de una orden; desaparece
 * del tablero cuando todos sus ítems están listos (o entregados).
 */
export async function getKdsTickets(ctx: TenantContext, station: Station): Promise<KdsTicket[]> {
  const { supabase, tenant } = ctx;
  const since = new Date(Date.now() - KDS_WINDOW_HOURS * 3_600_000).toISOString();

  const { data: items, error } = await supabase
    .from('order_items')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('station', station)
    .in('status', ['pending', 'in_preparation', 'ready'])
    .gte('created_at', since)
    .order('created_at');
  if (error) throw error;
  if (items.length === 0) return [];

  const orderIds = [...new Set(items.map((i) => i.order_id))];
  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('id, order_number, table_id, source, notes, status')
    .eq('tenant_id', tenant.id)
    .in('id', orderIds);
  if (ordersError) throw ordersError;

  const tableIds = [...new Set(orders.map((o) => o.table_id).filter((id): id is string => Boolean(id)))];
  const tablesRes = tableIds.length
    ? await supabase.from('tables').select('id, label').eq('tenant_id', tenant.id).in('id', tableIds)
    : { data: [] as Array<{ id: string; label: string }>, error: null };
  if (tablesRes.error) throw tablesRes.error;

  const orderMap = new Map(orders.map((o) => [o.id, o]));
  const tableLabels = new Map(tablesRes.data.map((t) => [t.id, t.label]));
  const tickets = new Map<string, KdsTicket>();

  for (const item of items) {
    const order = orderMap.get(item.order_id);
    if (!order || order.status === 'cancelled') continue;
    const key = `${item.order_id}:${item.round}`;
    let ticket = tickets.get(key);
    if (!ticket) {
      ticket = {
        key,
        orderId: order.id,
        orderNumber: order.order_number,
        round: item.round,
        tableLabel: order.table_id ? (tableLabels.get(order.table_id) ?? null) : null,
        source: order.source,
        orderNotes: order.notes,
        createdAt: item.created_at,
        items: [],
      };
      tickets.set(key, ticket);
    }
    ticket.items.push(item);
  }

  return [...tickets.values()]
    .filter((t) => t.items.some((i) => i.status !== 'ready'))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
