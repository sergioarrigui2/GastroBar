import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import { z } from 'zod';
import { Row, Rule, Ticket } from '@/components/print/Ticket';
import { currencyDecimals, remainingBalance, suggestedTip } from '@/lib/billing/split-bill';
import { getOpenBill } from '@/lib/services/orders';
import { requirePageRole } from '@/lib/tenant-context';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import type { PaymentMethod } from '@/types/domain';

export const metadata = { title: 'Cuenta' };

const METHOD: Record<PaymentMethod, string> = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', other: 'Otro' };

/** Precuenta (orden abierta) o recibo de pago (orden pagada): /print/bill/:id?auto=1 */
export default async function PrintBillPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ auto?: string }>;
}) {
  const ctx = await requirePageRole(['admin', 'cashier', 'waiter']);
  const [{ id }, { auto }] = await Promise.all([params, searchParams]);
  const orderId = z.uuid().safeParse(id);
  if (!orderId.success) notFound();

  const bill = await getOpenBill(ctx, { order_id: orderId.data });
  if (!bill) notFound();
  const { order, items } = bill;
  const payments = bill.payments.filter((p) => !p.voided_at);

  // Documento electrónico vigente de la venta (sólo admin/caja lo ven por RLS).
  const { data: edoc } = await ctx.supabase
    .from('einvoice_documents')
    .select('doc_type, status, provider, number, cufe, qr_data')
    .eq('tenant_id', ctx.tenant.id)
    .eq('order_id', order.id)
    .in('doc_type', ['pos', 'invoice'])
    .is('credited_at', null)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const edocQr = edoc?.status === 'accepted' && edoc.qr_data
    ? await QRCode.toString(edoc.qr_data, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })
    : null;

  const table = order.table_id
    ? (await ctx.supabase.from('tables').select('label').eq('id', order.table_id).maybeSingle()).data
    : null;

  const { currency, locale, timezone } = ctx.tenant;
  const money = (n: number) => formatCurrency(n, currency, locale);
  const decimals = currencyDecimals(currency);
  const remaining = remainingBalance(order.total, order.paid_amount, decimals);
  const isPaid = order.status === 'paid';
  const tips = payments.reduce((s, p) => s + p.tip, 0);
  const when = formatDateTime(order.closed_at ?? Date.now(), locale, timezone);
  const comps = items.filter((i) => i.comped).reduce((sum, i) => sum + i.gross_total, 0);

  // Agrupa líneas idénticas (mismo producto, modificadores, precio y cortesía) para un ticket compacto.
  const lines = new Map<string, { label: string; mods: string; qty: number; total: number; comped: boolean }>();
  for (const item of items) {
    const mods = item.modifiers.map((m) => m.name).join(', ');
    const key = `${item.product_id}|${mods}|${item.unit_price + item.modifiers_total}|${item.comped}`;
    const line = lines.get(key) ?? { label: item.product_name, mods, qty: 0, total: 0, comped: item.comped };
    line.qty += item.quantity;
    line.total += item.line_total;
    lines.set(key, line);
  }

  return (
    <Ticket
      tenant={ctx.tenant}
      title={isPaid ? 'Recibo de pago' : 'Precuenta'}
      autoPrint={auto === '1'}
      subtitle={
        <p>
          {table ? `Mesa ${table.label}` : 'Barra / llevar'} · Orden #{order.order_number}
          {order.guests ? ` · ${order.guests} pers.` : ''}
          <br />
          {when}
        </p>
      }
      footer={
        <>
          {!isPaid && <p>Propina sugerida (10%): {money(suggestedTip(remaining, 10, decimals))}</p>}
          {edoc?.status === 'accepted' ? (
            <div className="space-y-1">
              {edoc.provider === 'simulator' && <p className="font-bold">DOCUMENTO SIMULADO · SIN VALIDEZ FISCAL</p>}
              <p className="font-bold">
                {edoc.doc_type === 'invoice' ? 'Factura electrónica' : 'Documento equivalente POS electrónico'} {edoc.number}
              </p>
              {edoc.cufe && <p className="break-all text-[9px] leading-tight">{edoc.doc_type === 'invoice' ? 'CUFE' : 'CUDE'}: {edoc.cufe}</p>}
              {edocQr && <div className="mx-auto w-28" dangerouslySetInnerHTML={{ __html: edocQr }} />}
            </div>
          ) : edoc ? (
            <p>Documento electrónico en proceso de emisión.</p>
          ) : (
            <p>Documento no válido como factura electrónica.</p>
          )}
          {ctx.tenant.receipt_footer && <p className="mt-1">{ctx.tenant.receipt_footer}</p>}
        </>
      }
    >
      <ul className="space-y-1">
        {[...lines.values()].map((line, i) => (
          <li key={i}>
            <Row label={`${line.qty} x ${line.label}`} value={line.comped ? 'CORTESÍA' : money(line.total)} />
            {line.mods && <p className="pl-4 text-[11px]">+ {line.mods}</p>}
          </li>
        ))}
      </ul>
      <Rule />
      <Row label="Subtotal" value={money(order.subtotal)} />
      {comps > 0 && <Row label="Cortesías (no se cobran)" value={money(comps)} />}
      {order.discount_total > 0 && (
        <Row
          label={`Descuento${order.discount_type === 'percent' ? ` ${order.discount_value}%` : ''}`}
          value={`-${money(order.discount_total)}`}
        />
      )}
      <Row label="TOTAL" value={money(order.total)} bold />
      {order.tax_total > 0 && (
        <>
          <Row label="Base gravable" value={money(order.total - order.tax_total)} />
          <Row label={ctx.tenant.tax_name} value={money(order.tax_total)} />
        </>
      )}
      {payments.length > 0 && (
        <>
          <Rule />
          {payments.map((p) => (
            <Row
              key={p.id}
              label={`${METHOD[p.method]}${p.split_label ? ` (${p.split_label})` : ''}`}
              value={money(p.amount)}
            />
          ))}
          {tips > 0 && <Row label="Propinas" value={money(tips)} />}
          <Row label="Pagado" value={money(order.paid_amount)} bold />
        </>
      )}
      {!isPaid && (
        <>
          <Rule double />
          <Row label="SALDO A PAGAR" value={money(remaining)} bold />
        </>
      )}
    </Ticket>
  );
}
