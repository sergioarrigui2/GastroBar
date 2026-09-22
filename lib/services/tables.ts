import 'server-only';

import type { TenantContext } from '@/lib/tenant-context';
import { minutesSince } from '@/lib/utils';
import type { ItemStatus, OrderStatus, TableStatus } from '@/types/domain';

export const OPEN_ORDER_STATUSES = ['pending', 'in_preparation', 'ready', 'delivered'] as const satisfies readonly OrderStatus[];

export type OpenOrderSummary = {
  id: string;
  order_number: number;
  status: OrderStatus;
  total: number;
  paid_amount: number;
  remaining: number;
  guests: number | null;
  opened_at: string;
  minutes_open: number;
  items_by_status: Record<Exclude<ItemStatus, 'cancelled'>, number>;
};

export type TableStatusEntry = {
  id: string;
  label: string;
  seats: number;
  status: TableStatus;
  zone_id: string;
  zone_name: string;
  open_order: OpenOrderSummary | null;
};

export type TableStatusSnapshot = {
  zones: Array<{ id: string; name: string }>;
  tables: TableStatusEntry[];
  summary: { total: number; free: number; occupied: number; reserved: number; cleaning: number };
};

/** Mapa de mesas del tenant con ocupación y resumen de la orden abierta de cada una. */
export async function getTableStatus(
  ctx: TenantContext,
  opts: { zone_id?: string } = {},
): Promise<TableStatusSnapshot> {
  const { supabase, tenant } = ctx;

  let tablesQuery = supabase
    .from('tables')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('sort_order')
    .order('label');
  if (opts.zone_id) tablesQuery = tablesQuery.eq('zone_id', opts.zone_id);

  const [zonesRes, tablesRes, ordersRes] = await Promise.all([
    supabase.from('zones').select('id, name').eq('tenant_id', tenant.id).order('sort_order').order('name'),
    tablesQuery,
    supabase
      .from('orders')
      .select('id, table_id, order_number, status, total, paid_amount, guests, created_at')
      .eq('tenant_id', tenant.id)
      .in('status', OPEN_ORDER_STATUSES)
      .not('table_id', 'is', null),
  ]);
  if (zonesRes.error) throw zonesRes.error;
  if (tablesRes.error) throw tablesRes.error;
  if (ordersRes.error) throw ordersRes.error;

  const orderIds = ordersRes.data.map((o) => o.id);
  const itemsRes = orderIds.length
    ? await supabase
        .from('order_items')
        .select('order_id, status')
        .eq('tenant_id', tenant.id)
        .in('order_id', orderIds)
        .neq('status', 'cancelled')
    : { data: [] as Array<{ order_id: string; status: ItemStatus }>, error: null };
  if (itemsRes.error) throw itemsRes.error;

  const zoneNames = new Map(zonesRes.data.map((z) => [z.id, z.name]));
  const now = Date.now();

  const orderByTable = new Map<string, OpenOrderSummary>();
  for (const o of ordersRes.data) {
    if (!o.table_id) continue;
    orderByTable.set(o.table_id, {
      id: o.id,
      order_number: o.order_number,
      status: o.status,
      total: o.total,
      paid_amount: o.paid_amount,
      remaining: Math.max(0, o.total - o.paid_amount),
      guests: o.guests,
      opened_at: o.created_at,
      minutes_open: minutesSince(o.created_at, now),
      items_by_status: { pending: 0, in_preparation: 0, ready: 0, delivered: 0 },
    });
  }
  const orderById = new Map([...orderByTable.values()].map((o) => [o.id, o]));
  for (const item of itemsRes.data) {
    const summary = orderById.get(item.order_id);
    if (summary && item.status !== 'cancelled') summary.items_by_status[item.status] += 1;
  }

  const tables: TableStatusEntry[] = tablesRes.data.map((t) => ({
    id: t.id,
    label: t.label,
    seats: t.seats,
    status: t.status,
    zone_id: t.zone_id,
    zone_name: zoneNames.get(t.zone_id) ?? '',
    open_order: orderByTable.get(t.id) ?? null,
  }));

  const count = (s: TableStatus) => tables.filter((t) => t.status === s).length;
  return {
    zones: zonesRes.data,
    tables,
    summary: {
      total: tables.length,
      free: count('free'),
      occupied: count('occupied'),
      reserved: count('reserved'),
      cleaning: count('cleaning'),
    },
  };
}

export async function setTableStatus(ctx: TenantContext, tableId: string, status: TableStatus): Promise<void> {
  const { error } = await ctx.supabase
    .from('tables')
    .update({ status })
    .eq('tenant_id', ctx.tenant.id)
    .eq('id', tableId);
  if (error) throw error;
}
