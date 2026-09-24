import { AgentNotice } from '@/components/admin/ai/AgentAvatar';
import { CashRegister } from '@/components/cash/CashRegister';
import { getCashNotices } from '@/lib/services/agent-notices';
import { getCashSession, listCashSessions, profileNames } from '@/lib/services/cash';
import { requirePageRole } from '@/lib/tenant-context';

export const metadata = { title: 'Caja' };
export const dynamic = 'force-dynamic';

export default async function CashPage() {
  const ctx = await requirePageRole(['admin', 'cashier']);
  const [session, history, names, notices] = await Promise.all([
    getCashSession(ctx),
    listCashSessions(ctx),
    profileNames(ctx),
    getCashNotices(ctx),
  ]);

  const paidOrders = session
    ? await ctx.supabase
        .from('orders')
        .select('id, order_number, table_id, total, closed_at')
        .eq('tenant_id', ctx.tenant.id)
        .eq('status', 'paid')
        .gte('closed_at', session.opened_at)
        .order('closed_at', { ascending: false })
        .limit(25)
    : {
        data: [] as Array<{ id: string; order_number: number; table_id: string | null; total: number; closed_at: string | null }>,
      };

  const tableIds = [...new Set((paidOrders.data ?? []).map((o) => o.table_id).filter((v): v is string => Boolean(v)))];
  const tables = tableIds.length
    ? ((await ctx.supabase.from('tables').select('id, label').eq('tenant_id', ctx.tenant.id).in('id', tableIds)).data ?? [])
    : [];
  const labels = new Map(tables.map((t) => [t.id, t.label]));

  return (
    <>
      {notices.length > 0 && (
        <div className="mx-auto max-w-5xl px-4 pt-5">
          <AgentNotice agent="vigia" headline="revisé tus cierres de caja" items={notices} />
        </div>
      )}
      <CashRegister
        tenant={{
          id: ctx.tenant.id,
          name: ctx.tenant.name,
          currency: ctx.tenant.currency,
          locale: ctx.tenant.locale,
          timezone: ctx.tenant.timezone,
        }}
        role={ctx.role}
        session={session}
        openedByName={session?.opened_by ? (names[session.opened_by] ?? null) : null}
        history={history}
        paidOrders={(paidOrders.data ?? []).map((o) => ({
          id: o.id,
          orderNumber: o.order_number,
          tableLabel: o.table_id ? (labels.get(o.table_id) ?? null) : null,
          total: o.total,
          closedAt: o.closed_at,
        }))}
      />
    </>
  );
}
