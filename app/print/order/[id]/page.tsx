import { notFound } from 'next/navigation';
import { z } from 'zod';
import { Rule, Ticket } from '@/components/print/Ticket';
import { requirePageRole } from '@/lib/tenant-context';
import { stationSchema } from '@/lib/validations/order';

export const metadata = { title: 'Comanda' };

/** Comanda para cocina o barra: /print/order/:id?station=bar&round=2&auto=1 */
export default async function PrintOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ station?: string; round?: string; auto?: string }>;
}) {
  const ctx = await requirePageRole(['admin', 'cashier', 'waiter', 'kitchen', 'bar']);
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const orderId = z.uuid().safeParse(id);
  if (!orderId.success) notFound();
  const station = stationSchema.safeParse(query.station);
  const round = z.coerce.number().int().positive().safeParse(query.round);

  const { data: order } = await ctx.supabase
    .from('orders')
    .select('id, order_number, table_id, notes, source, created_at')
    .eq('tenant_id', ctx.tenant.id)
    .eq('id', orderId.data)
    .maybeSingle();
  if (!order) notFound();

  let itemsQuery = ctx.supabase
    .from('order_items')
    .select('*')
    .eq('tenant_id', ctx.tenant.id)
    .eq('order_id', order.id)
    .neq('status', 'cancelled')
    .order('round')
    .order('created_at');
  if (station.success) itemsQuery = itemsQuery.eq('station', station.data);
  if (round.success) itemsQuery = itemsQuery.eq('round', round.data);

  const [{ data: items }, { data: table }] = await Promise.all([
    itemsQuery,
    order.table_id
      ? ctx.supabase.from('tables').select('label').eq('id', order.table_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const time = new Intl.DateTimeFormat(ctx.tenant.locale, {
    timeZone: ctx.tenant.timezone,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(items?.[0]?.created_at ?? order.created_at));
  const title = station.success ? (station.data === 'bar' ? 'Comanda barra' : 'Comanda cocina') : 'Comanda';

  return (
    <Ticket
      tenant={ctx.tenant}
      title={title}
      autoPrint={query.auto === '1'}
      large
      subtitle={
        <>
          <p className="text-[22px] font-black">{table ? `MESA ${table.label}` : 'BARRA / LLEVAR'}</p>
          <p>
            Orden #{order.order_number}
            {round.success && ` · Ronda ${round.data}`} · {time}
          </p>
          {order.source === 'ai_agent' && <p>(creada por agente IA)</p>}
        </>
      }
    >
      {order.notes && (
        <>
          <p className="font-bold">NOTA: {order.notes}</p>
          <Rule />
        </>
      )}
      <ul className="space-y-1.5">
        {(items ?? []).map((item) => (
          <li key={item.id}>
            <p className="font-bold">
              {item.quantity} x {item.product_name}
            </p>
            {item.modifiers.map((m) => (
              <p key={m.id} className="pl-4">
                + {m.name}
              </p>
            ))}
            {item.notes && <p className="pl-4 font-bold">!! {item.notes}</p>}
          </li>
        ))}
        {(items ?? []).length === 0 && <li>Sin ítems para esta estación.</li>}
      </ul>
      <Rule />
      <p className="text-center">{(items ?? []).reduce((s, i) => s + i.quantity, 0)} ítem(s)</p>
    </Ticket>
  );
}
