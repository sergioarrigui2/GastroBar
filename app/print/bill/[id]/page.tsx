import { notFound } from 'next/navigation';
import { z } from 'zod';
import { Row, Rule, Ticket } from '@/components/print/Ticket';
import { currencyDecimals, remainingBalance, suggestedTip } from '@/lib/billing/split-bill';
import { getOpenBill } from '@/lib/services/orders';
import { requirePageRole } from '@/lib/tenant-context';
import { formatCurrency } from '@/lib/utils';
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
  const { order, items, payments } = bill;

  const table = order.table_id
    ? (await ctx.supabase.from('tables').select('label').eq('id', order.table_id).maybeSingle()).data
    : null;

  const { currency, locale, timezone } = ctx.tenant;
  const money = (n: number) => formatCurrency(n, currency, locale);
  const decimals = currencyDecimals(currency);
  const remaining = remainingBalance(order.total, order.paid_amount, decimals);
  const isPaid = order.status === 'paid';
  const tips = payments.reduce((s, p) => s + p.tip, 0);
  const when = new Intl.DateTimeFormat(locale, { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(order.closed_at ?? Date.now()),
  );

  // Agrupa líneas idénticas (mismo producto, modificadores y precio) para un ticket compacto.
  const lines = new Map<string, { label: string; mods: string; qty: number; total: number }>();
  for (const item of items) {
    const mods = item.modifiers.map((m) => m.name).join(', ');
    const key = `${item.product_id}|${mods}|${item.unit_price + item.modifiers_total}`;
    const line = lines.get(key) ?? { label: item.product_name, mods, qty: 0, total: 0 };
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
          <p>Documento no válido como factura electrónica.</p>
          {ctx.tenant.receipt_footer && <p className="mt-1">{ctx.tenant.receipt_footer}</p>}
        </>
      }
    >
      <ul className="space-y-1">
        {[...lines.values()].map((line, i) => (
          <li key={i}>
            <Row label={`${line.qty} x ${line.label}`} value={money(line.total)} />
            {line.mods && <p className="pl-4 text-[11px]">+ {line.mods}</p>}
          </li>
        ))}
      </ul>
      <Rule />
      <Row label="TOTAL" value={money(order.total)} bold />
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
