import 'server-only';

import type { TenantContext } from '@/lib/tenant-context';
import type { Json, Tables } from '@/types/database';
import { billTicket, cashTicket, orderTicket, type OrderTicketItem } from './documents';
import { normalizeSettings, type PrintDoc, type PrintDocumentKind, type PrintSettings, routeOrderItems } from './types';

/**
 * Cola de impresión: la app arma el tiquete y lo deja en print_jobs para la
 * impresora que corresponda según Ajustes → Impresión. GastroBar Print lo imprime.
 * Imprimir nunca bloquea la operación: si algo falla aquí, la venta sigue.
 */
type Printer = Pick<Tables<'printers'>, 'id' | 'name' | 'is_active'>;
export type Queued = { queued: boolean; printer?: string };

async function config(ctx: TenantContext): Promise<{ settings: PrintSettings; printers: Map<string, Printer> }> {
  const [settingsRes, printersRes] = await Promise.all([
    ctx.supabase.from('print_settings').select('routes, category_overrides, options').eq('tenant_id', ctx.tenant.id).maybeSingle(),
    ctx.supabase.from('printers').select('id, name, is_active').eq('tenant_id', ctx.tenant.id).eq('is_active', true),
  ]);
  if (settingsRes.error) throw settingsRes.error;
  if (printersRes.error) throw printersRes.error;
  return { settings: normalizeSettings(settingsRes.data), printers: new Map((printersRes.data ?? []).map((p) => [p.id, p])) };
}

async function enqueue(
  ctx: TenantContext,
  job: { printer_id: string; document: PrintDocumentKind | 'test'; ref_id?: string | null; title: string; payload: PrintDoc; copies?: number; open_drawer?: boolean },
): Promise<void> {
  const { error } = await ctx.supabase.from('print_jobs').insert({
    printer_id: job.printer_id,
    document: job.document,
    ref_id: job.ref_id ?? null,
    title: job.title.slice(0, 120),
    payload: job.payload as unknown as Json,
    copies: Math.min(5, Math.max(1, job.copies ?? 1)),
    open_drawer: job.open_drawer ?? false,
  });
  if (error) throw error;
}

/** Comandas de una ronda: una por impresora (cocina, barra o la que diga la categoría). */
export async function enqueueOrderTickets(ctx: TenantContext, orderId: string, round?: number, onlyStation?: 'kitchen' | 'bar'): Promise<number> {
  const { settings, printers } = await config(ctx);
  if (!printers.size) return 0;

  const { data: order, error } = await ctx.supabase
    .from('orders')
    .select('id, order_number, table_id, waiter_id, notes, source, created_at')
    .eq('tenant_id', ctx.tenant.id)
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw error;
  if (!order) return 0;

  let itemsQuery = ctx.supabase
    .from('order_items')
    .select('product_id, product_name, quantity, modifiers, notes, line_total, station, round, created_at')
    .eq('tenant_id', ctx.tenant.id)
    .eq('order_id', orderId)
    .neq('status', 'cancelled')
    .order('created_at');
  if (round) itemsQuery = itemsQuery.eq('round', round);
  if (onlyStation) itemsQuery = itemsQuery.eq('station', onlyStation);
  const { data: rows, error: itemsError } = await itemsQuery;
  if (itemsError) throw itemsError;
  if (!rows?.length) return 0;

  const productIds = [...new Set(rows.map((r) => r.product_id))];
  const [{ data: products }, { data: table }, { data: waiter }] = await Promise.all([
    ctx.supabase.from('products').select('id, category_id').eq('tenant_id', ctx.tenant.id).in('id', productIds),
    order.table_id ? ctx.supabase.from('tables').select('label').eq('id', order.table_id).maybeSingle() : Promise.resolve({ data: null }),
    order.waiter_id ? ctx.supabase.from('profiles').select('full_name').eq('id', order.waiter_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const categoryOf = new Map((products ?? []).map((p) => [p.id, p.category_id]));
  const items = rows.map((r) => ({ ...r, category_id: categoryOf.get(r.product_id) ?? null, modifiers: r.modifiers as unknown as Array<{ name: string }> }));

  // Reimpresión desde el KDS de una estación: va a la impresora de esa estación.
  const routed = onlyStation
    ? new Map(
        [[settings.routes[onlyStation === 'bar' ? 'bar_order' : 'kitchen_order'] ?? '', items]].filter(([id]) => Boolean(id)) as Array<[string, typeof items]>,
      )
    : routeOrderItems(items, settings);

  let count = 0;
  for (const [printerId, list] of routed) {
    if (!printers.has(printerId)) continue;
    const doc = orderTicket(ctx, order, table?.label ?? null, waiter?.full_name ?? null, round ?? Math.max(...list.map((i) => i.round)), list as OrderTicketItem[], settings.options);
    const station = list.some((i) => i.station === 'kitchen') ? 'kitchen_order' : 'bar_order';
    await enqueue(ctx, {
      printer_id: printerId,
      document: station,
      ref_id: orderId,
      title: `Comanda ${table ? `Mesa ${table.label}` : 'barra'} #${order.order_number}${round && round > 1 ? ` R${round}` : ''}`,
      payload: doc,
      copies: settings.options.order_copies,
    });
    count++;
  }
  return count;
}

/** Precuenta o recibo en la impresora configurada (el recibo puede abrir el cajón). */
export async function enqueueBill(ctx: TenantContext, orderId: string, opts: { openDrawer?: boolean } = {}): Promise<Queued> {
  const { settings, printers } = await config(ctx);
  const ticket = await billTicket(ctx, orderId);
  if (!ticket) return { queued: false };
  const kind: PrintDocumentKind = ticket.paid ? 'receipt' : 'prebill';
  const printer = printers.get(settings.routes[kind] ?? '');
  if (!printer) return { queued: false };
  await enqueue(ctx, { printer_id: printer.id, document: kind, ref_id: orderId, title: ticket.title, payload: ticket.doc, open_drawer: Boolean(opts.openDrawer) });
  return { queued: true, printer: printer.name };
}

export async function enqueueCashReport(ctx: TenantContext, sessionId: string): Promise<Queued> {
  const { settings, printers } = await config(ctx);
  const printer = printers.get(settings.routes.cash_report ?? '');
  if (!printer) return { queued: false };
  const ticket = await cashTicket(ctx, sessionId);
  if (!ticket) return { queued: false };
  await enqueue(ctx, { printer_id: printer.id, document: 'cash_report', ref_id: sessionId, title: ticket.title, payload: ticket.doc });
  return { queued: true, printer: printer.name };
}

export async function enqueueTestTicket(ctx: TenantContext, printerId: string, doc: PrintDoc): Promise<void> {
  await enqueue(ctx, { printer_id: printerId, document: 'test', title: 'Prueba de impresión', payload: doc });
}

export async function printSettingsFor(ctx: TenantContext) {
  return (await config(ctx)).settings;
}

/** Envuelve un disparo automático: nunca rompe la venta; deja rastro en el log del servidor. */
export async function safely<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    console.error(`[impresión] ${label}:`, error);
    return undefined;
  }
}
