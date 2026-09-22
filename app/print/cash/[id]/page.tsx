import { notFound } from 'next/navigation';
import { z } from 'zod';
import { Row, Rule, Ticket } from '@/components/print/Ticket';
import { getCashSession, profileNames } from '@/lib/services/cash';
import { requirePageRole } from '@/lib/tenant-context';
import { formatCurrency } from '@/lib/utils';
import type { PaymentMethod } from '@/types/domain';

export const metadata = { title: 'Reporte de caja' };

const METHOD: Record<PaymentMethod, string> = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', other: 'Otro' };

/** Reporte Z (caja cerrada) o X (caja abierta, parcial): /print/cash/:id?auto=1 */
export default async function PrintCashPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ auto?: string }>;
}) {
  const ctx = await requirePageRole(['admin', 'cashier']);
  const [{ id }, { auto }] = await Promise.all([params, searchParams]);
  const sessionId = z.uuid().safeParse(id);
  if (!sessionId.success) notFound();

  const [session, names] = await Promise.all([getCashSession(ctx, sessionId.data), profileNames(ctx)]);
  if (!session) notFound();
  const r = session.report;
  const { currency, locale, timezone } = ctx.tenant;
  const money = (n: number) => formatCurrency(n, currency, locale);
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(locale, { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
  const closed = Boolean(session.closed_at);

  return (
    <Ticket
      tenant={ctx.tenant}
      title={closed ? 'Cierre de caja (Z)' : 'Corte parcial (X)'}
      autoPrint={auto === '1'}
      subtitle={
        <>
          <p>Apertura: {fmt(session.opened_at)}</p>
          <p>{closed ? `Cierre: ${fmt(session.closed_at!)}` : `Corte: ${fmt(r.to)}`}</p>
          {session.opened_by && <p>Abrió: {names[session.opened_by] ?? '—'}</p>}
          {session.closed_by && <p>Cerró: {names[session.closed_by] ?? '—'}</p>}
        </>
      }
      footer={closed ? <p>Firma: ______________________</p> : <p>Reporte parcial — la caja sigue abierta.</p>}
    >
      <Row label="Cuentas pagadas" value={r.orders_paid} />
      <Row label="Órdenes anuladas" value={r.orders_cancelled} />
      <Row label="Pagos registrados" value={r.payments_count} />
      <Rule />
      <p className="font-bold">VENTAS POR MEDIO</p>
      {(Object.keys(METHOD) as PaymentMethod[])
        .filter((m) => r.by_method[m])
        .map((m) => (
          <Row key={m} label={`${METHOD[m]} (${r.by_method[m]!.count})`} value={money(r.by_method[m]!.amount)} />
        ))}
      <Row label="TOTAL VENTAS" value={money(r.sales)} bold />
      <Row label="Propinas" value={money(r.tips)} />
      <Rule />
      <p className="font-bold">EFECTIVO</p>
      <Row label="Fondo inicial" value={money(r.opening_float)} />
      <Row label="+ Ventas efectivo" value={money(r.cash_sales)} />
      <Row label="+ Propinas efectivo" value={money(r.cash_tips)} />
      <Row label="+ Entradas" value={money(r.cash_in)} />
      <Row label="- Retiros" value={money(r.cash_out)} />
      <Row label="ESPERADO EN CAJA" value={money(r.expected_cash)} bold />
      {closed && (
        <>
          <Row label="CONTADO" value={money(session.counted_cash ?? 0)} bold />
          <Row
            label="DIFERENCIA"
            value={`${(session.difference ?? 0) > 0 ? '+' : ''}${money(session.difference ?? 0)}`}
            bold
          />
          {session.notes && <p className="mt-1">Obs.: {session.notes}</p>}
        </>
      )}
      {r.movements.length > 0 && (
        <>
          <Rule />
          <p className="font-bold">MOVIMIENTOS</p>
          {r.movements.map((m, i) => (
            <Row key={i} label={`${m.type === 'in' ? '+' : '-'} ${m.reason}`} value={money(m.amount)} />
          ))}
        </>
      )}
    </Ticket>
  );
}
