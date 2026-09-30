import 'server-only';

import { currencyDecimals, remainingBalance, suggestedTip } from '@/lib/billing/split-bill';
import { getCashSession, profileNames } from '@/lib/services/cash';
import { getOpenBill } from '@/lib/services/orders';
import type { TenantContext } from '@/lib/tenant-context';
import { formatCurrency } from '@/lib/utils';
import type { PaymentMethod } from '@/types/domain';
import type { PrintBlock, PrintDoc, PrintOptions } from './types';

const METHOD: Record<PaymentMethod, string> = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', other: 'Otro' };

function header(ctx: TenantContext, title: string, lines: string[]): PrintBlock[] {
  const t = ctx.tenant;
  return [
    { t: 'text', text: t.name, align: 'center', bold: true, big: true },
    ...(t.tax_id ? [{ t: 'text', text: `NIT ${t.tax_id}`, align: 'center' } as const] : []),
    ...([t.address, t.city].some(Boolean) ? [{ t: 'text', text: [t.address, t.city].filter(Boolean).join(' · '), align: 'center' } as const] : []),
    ...(t.phone ? [{ t: 'text', text: `Tel. ${t.phone}`, align: 'center' } as const] : []),
    { t: 'rule' },
    { t: 'text', text: title.toUpperCase(), align: 'center', bold: true },
    ...lines.map((text) => ({ t: 'text', text, align: 'center' }) as const),
    { t: 'rule' },
  ];
}

const when = (ctx: TenantContext, iso: string | number | Date) =>
  new Intl.DateTimeFormat(ctx.tenant.locale, { timeZone: ctx.tenant.timezone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));

export type OrderTicketItem = {
  quantity: number;
  product_name: string;
  modifiers: Array<{ name: string }>;
  notes: string | null;
  line_total: number;
  station: 'kitchen' | 'bar';
};

/** Comanda para cocina / barra: grande y sin el encabezado del negocio (ahorra papel). */
export function orderTicket(
  ctx: TenantContext,
  order: { order_number: number; notes: string | null; source: string; created_at: string },
  tableLabel: string | null,
  waiter: string | null,
  round: number,
  items: OrderTicketItem[],
  options: PrintOptions,
): PrintDoc {
  const stations = new Set(items.map((i) => i.station));
  const title = stations.size > 1 ? 'Comanda' : stations.has('bar') ? 'Comanda barra' : 'Comanda cocina';
  const money = (n: number) => formatCurrency(n, ctx.tenant.currency, ctx.tenant.locale);
  const blocks: PrintBlock[] = [
    { t: 'text', text: title.toUpperCase(), align: 'center', bold: true },
    { t: 'text', text: tableLabel ? `MESA ${tableLabel}` : 'BARRA / LLEVAR', align: 'center', bold: true, big: true },
    { t: 'text', text: `Orden #${order.order_number}${round > 1 ? ` · Ronda ${round}` : ''} · ${when(ctx, Date.now())}`, align: 'center' },
    ...(waiter ? [{ t: 'text', text: `Mesero: ${waiter}`, align: 'center' } as const] : []),
    ...(order.source === 'ai_agent' ? [{ t: 'text', text: '(creada por agente IA)', align: 'center' } as const] : []),
    ...(order.source === 'qr' ? [{ t: 'text', text: '(pedido desde el QR)', align: 'center' } as const] : []),
    { t: 'rule' },
  ];
  if (order.notes) blocks.push({ t: 'text', text: `NOTA: ${order.notes}`, bold: true, big: options.large_notes }, { t: 'rule' });
  for (const item of items) {
    const label = `${item.quantity} x ${item.product_name}`;
    blocks.push(options.prices_on_order ? { t: 'row', left: label, right: money(item.line_total), bold: true } : { t: 'text', text: label, bold: true, big: options.large_notes });
    for (const m of item.modifiers) blocks.push({ t: 'text', text: `   + ${m.name}` });
    if (item.notes) blocks.push({ t: 'text', text: `  !! ${item.notes}`, bold: true, big: options.large_notes });
  }
  blocks.push({ t: 'rule' }, { t: 'text', text: `${items.reduce((s, i) => s + i.quantity, 0)} ítem(s)`, align: 'center' });
  return { blocks };
}

/** Precuenta (cuenta abierta) o recibo (cuenta pagada). */
export async function billTicket(ctx: TenantContext, orderId: string): Promise<{ doc: PrintDoc; title: string; paid: boolean } | null> {
  const bill = await getOpenBill(ctx, { order_id: orderId });
  if (!bill) return null;
  const { order, items } = bill;
  const payments = bill.payments.filter((p) => !p.voided_at);
  const table = order.table_id ? (await ctx.supabase.from('tables').select('label').eq('id', order.table_id).maybeSingle()).data : null;
  const { data: edoc } = await ctx.supabase
    .from('einvoice_documents')
    .select('doc_type, status, provider, number, cufe')
    .eq('tenant_id', ctx.tenant.id)
    .eq('order_id', order.id)
    .in('doc_type', ['pos', 'invoice'])
    .is('credited_at', null)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const money = (n: number) => formatCurrency(n, ctx.tenant.currency, ctx.tenant.locale);
  const decimals = currencyDecimals(ctx.tenant.currency);
  const remaining = remainingBalance(order.total, order.paid_amount, decimals);
  const paid = order.status === 'paid';
  const place = table ? `Mesa ${table.label}` : 'Barra / llevar';
  const title = paid ? 'Recibo de pago' : 'Precuenta';

  const blocks = header(ctx, title, [
    `${place} · Orden #${order.order_number}${order.guests ? ` · ${order.guests} pers.` : ''}`,
    when(ctx, order.closed_at ?? Date.now()),
  ]);

  // Líneas idénticas agrupadas, como en el tiquete del navegador.
  const lines = new Map<string, { label: string; mods: string; qty: number; total: number; comped: boolean }>();
  for (const item of items) {
    const mods = item.modifiers.map((m) => m.name).join(', ');
    const key = `${item.product_id}|${mods}|${item.unit_price + item.modifiers_total}|${item.comped}`;
    const line = lines.get(key) ?? { label: item.product_name, mods, qty: 0, total: 0, comped: item.comped };
    line.qty += item.quantity;
    line.total += item.line_total;
    lines.set(key, line);
  }
  for (const line of lines.values()) {
    blocks.push({ t: 'row', left: `${line.qty} x ${line.label}`, right: line.comped ? 'CORTESÍA' : money(line.total) });
    if (line.mods) blocks.push({ t: 'text', text: `   + ${line.mods}` });
  }
  const comps = items.filter((i) => i.comped).reduce((s, i) => s + i.gross_total, 0);
  blocks.push({ t: 'rule' }, { t: 'row', left: 'Subtotal', right: money(order.subtotal) });
  if (comps > 0) blocks.push({ t: 'row', left: 'Cortesías (no se cobran)', right: money(comps) });
  if (order.discount_total > 0) {
    blocks.push({ t: 'row', left: `Descuento${order.discount_type === 'percent' ? ` ${order.discount_value}%` : ''}`, right: `-${money(order.discount_total)}` });
  }
  blocks.push({ t: 'row', left: 'TOTAL', right: money(order.total), bold: true });
  if (order.tax_total > 0) {
    blocks.push({ t: 'row', left: 'Base gravable', right: money(order.total - order.tax_total) }, { t: 'row', left: ctx.tenant.tax_name, right: money(order.tax_total) });
  }
  if (payments.length) {
    blocks.push({ t: 'rule' });
    for (const p of payments) blocks.push({ t: 'row', left: `${METHOD[p.method]}${p.split_label ? ` (${p.split_label})` : ''}`, right: money(p.amount) });
    const tips = payments.reduce((s, p) => s + p.tip, 0);
    if (tips > 0) blocks.push({ t: 'row', left: 'Propinas', right: money(tips) });
    blocks.push({ t: 'row', left: 'Pagado', right: money(order.paid_amount), bold: true });
  }
  if (!paid) {
    blocks.push({ t: 'rule', char: '=' }, { t: 'row', left: 'SALDO A PAGAR', right: money(remaining), bold: true });
    blocks.push({ t: 'text', text: `Propina sugerida (10%): ${money(suggestedTip(remaining, 10, decimals))}`, align: 'center' });
  }
  blocks.push({ t: 'rule' });
  if (edoc?.status === 'accepted') {
    if (edoc.provider === 'simulator') blocks.push({ t: 'text', text: 'DOCUMENTO SIMULADO · SIN VALIDEZ FISCAL', align: 'center', bold: true });
    blocks.push({ t: 'text', text: `${edoc.doc_type === 'invoice' ? 'Factura electrónica' : 'Documento equivalente POS electrónico'} ${edoc.number ?? ''}`, align: 'center', bold: true });
    if (edoc.cufe) blocks.push({ t: 'text', text: `${edoc.doc_type === 'invoice' ? 'CUFE' : 'CUDE'}: ${edoc.cufe}` });
  } else {
    blocks.push({ t: 'text', text: edoc ? 'Documento electrónico en proceso de emisión.' : 'Documento no válido como factura electrónica.', align: 'center' });
  }
  if (ctx.tenant.receipt_footer) blocks.push({ t: 'text', text: ctx.tenant.receipt_footer, align: 'center' });
  return { doc: { blocks }, title: `${title} ${place} #${order.order_number}`, paid };
}

/** Corte parcial (X) o cierre (Z) de caja. */
export async function cashTicket(ctx: TenantContext, sessionId: string): Promise<{ doc: PrintDoc; title: string } | null> {
  const [session, names] = await Promise.all([getCashSession(ctx, sessionId), profileNames(ctx)]);
  if (!session) return null;
  const r = session.report;
  const money = (n: number) => formatCurrency(n, ctx.tenant.currency, ctx.tenant.locale);
  const closed = Boolean(session.closed_at);
  const title = closed ? 'Cierre de caja (Z)' : 'Corte parcial (X)';
  const blocks = header(ctx, title, [
    `Apertura: ${when(ctx, session.opened_at)}`,
    closed ? `Cierre: ${when(ctx, session.closed_at!)}` : `Corte: ${when(ctx, r.to)}`,
    ...(session.opened_by ? [`Abrió: ${names[session.opened_by] ?? '—'}`] : []),
    ...(session.closed_by ? [`Cerró: ${names[session.closed_by] ?? '—'}`] : []),
  ]);
  blocks.push(
    { t: 'row', left: 'Cuentas pagadas', right: String(r.orders_paid) },
    { t: 'row', left: 'Órdenes anuladas', right: String(r.orders_cancelled) },
    { t: 'row', left: 'Pagos registrados', right: String(r.payments_count) },
    { t: 'rule' },
    { t: 'text', text: 'VENTAS POR MEDIO', bold: true },
  );
  for (const m of Object.keys(METHOD) as PaymentMethod[]) {
    const v = r.by_method[m];
    if (v) blocks.push({ t: 'row', left: `${METHOD[m]} (${v.count})`, right: money(v.amount) });
  }
  blocks.push(
    { t: 'row', left: 'TOTAL VENTAS', right: money(r.sales), bold: true },
    { t: 'row', left: 'Propinas', right: money(r.tips) },
    { t: 'rule' },
    { t: 'text', text: 'AJUSTES E IMPUESTOS', bold: true },
    { t: 'row', left: 'Descuentos', right: money(r.discounts ?? 0) },
    { t: 'row', left: 'Cortesías', right: money(r.comps ?? 0) },
    { t: 'row', left: `Impuestos (${ctx.tenant.tax_name})`, right: money(r.tax ?? 0) },
    { t: 'row', left: `Pagos anulados (${r.voided_count ?? 0})`, right: money(r.voided_amount ?? 0) },
    { t: 'rule' },
    { t: 'text', text: 'EFECTIVO', bold: true },
    { t: 'row', left: 'Fondo inicial', right: money(r.opening_float) },
    { t: 'row', left: '+ Ventas efectivo', right: money(r.cash_sales) },
    { t: 'row', left: '+ Propinas efectivo', right: money(r.cash_tips) },
    { t: 'row', left: '+ Entradas', right: money(r.cash_in) },
    { t: 'row', left: '- Retiros', right: money(r.cash_out) },
    { t: 'row', left: 'ESPERADO EN CAJA', right: money(r.expected_cash), bold: true },
  );
  if (closed) {
    const diff = session.difference ?? 0;
    blocks.push(
      { t: 'row', left: 'CONTADO', right: money(session.counted_cash ?? 0), bold: true },
      { t: 'row', left: 'DIFERENCIA', right: `${diff > 0 ? '+' : ''}${money(diff)}`, bold: true },
    );
    if (session.notes) blocks.push({ t: 'text', text: `Obs.: ${session.notes}` });
  }
  if (r.movements.length) {
    blocks.push({ t: 'rule' }, { t: 'text', text: 'MOVIMIENTOS', bold: true });
    for (const m of r.movements) blocks.push({ t: 'row', left: `${m.type === 'in' ? '+' : '-'} ${m.reason}`, right: money(m.amount) });
  }
  blocks.push({ t: 'rule' }, { t: 'text', text: closed ? 'Firma: ______________________' : 'Reporte parcial — la caja sigue abierta.', align: 'center' });
  return { doc: { blocks }, title };
}
